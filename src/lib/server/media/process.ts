import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { Config } from '#lib/server/config.ts';
import { MEDIA_TYPES, MEDIA_VARIANTS } from '#lib/server/db/schema.ts';
import script from './process-media.py?raw';
import sharpScript from './resize-image.cjs?raw';
import { storeMediaFile } from './store.ts';

export class UploadError extends Error {
	constructor(public readonly code: 'invalid' | 'size' | 'unsupported' | 'busy' | 'unavailable') {
		super(`Media upload ${code}`);
	}
}

const metadataSchema = z.strictObject({
	contentType: z.enum(MEDIA_TYPES),
	captureDate: z.iso.date().nullable(),
	lat: z.number().min(-90).max(90).nullable(),
	lon: z.number().min(-180).max(180).nullable(),
	sizes: z.tuple([z.int().positive(), z.int().positive(), z.int().positive()])
});

function splitOutput(output: Readable) {
	const iterator = output[Symbol.asyncIterator]();
	let remainder = Buffer.alloc(0);
	return {
		async *take(size: number) {
			let left = size;
			while (left > 0) {
				if (remainder.length === 0) {
					const chunk = await iterator.next();
					if (chunk.done) throw new UploadError('unsupported');
					remainder = Buffer.from(chunk.value as Uint8Array);
				}
				const count = Math.min(left, remainder.length);
				yield remainder.subarray(0, count);
				remainder = remainder.subarray(count);
				left -= count;
			}
		},
		async verifyEnd() {
			if (remainder.length || !(await iterator.next()).done) throw new UploadError('unavailable');
		}
	};
}

async function readMetadata(pipe: Readable) {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of pipe) {
		const bytes = Buffer.from(chunk as Uint8Array);
		size += bytes.length;
		if (size > 4096) throw new UploadError('unavailable');
		chunks.push(bytes);
	}
	if (!size) return null;
	return metadataSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

export async function processMedia(
	source: Readable,
	config: Config,
	wrappingKey: Buffer,
	signal: AbortSignal,
	staged: string[]
) {
	const deadline = AbortSignal.any([signal, AbortSignal.timeout(6 * 60_000)]);
	const child = spawn(
		'python3',
		[
			'-I',
			'-B',
			'-c',
			script,
			String(config.limits.maxFileBytes),
			process.execPath,
			resolve('node_modules'),
			sharpScript
		],
		{
			stdio: ['pipe', 'pipe', 'ignore', 'pipe'],
			detached: true,
			env: config.mediaToolEnv
		}
	);
	const stop = () => {
		if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
		try {
			process.kill(-child.pid, 'SIGKILL');
		} catch (cause) {
			if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause;
		}
	};
	deadline.addEventListener('abort', stop, { once: true });
	const closed = once(child, 'close').then(
		([status]) => status as number | null,
		() => null
	);
	const input = pipeline(source, child.stdin!, { signal: deadline }).then(
		() => true,
		() => false
	);
	const output = splitOutput(child.stdout!);
	try {
		deadline.throwIfAborted();
		const metadata = await readMetadata(child.stdio[3] as Readable);
		if (!metadata) throw new UploadError((await closed) === 3 ? 'unsupported' : 'unavailable');
		const variants = [];
		for (const [index, variant] of MEDIA_VARIANTS.entries()) {
			const size = metadata.sizes[index]!;
			const contentType =
				variant === 'original'
					? metadata.contentType
					: variant === 'preview' && metadata.contentType.startsWith('video/')
						? 'video/mp4'
						: 'image/jpeg';
			const asset = await storeMediaFile(config.dataDir, wrappingKey, size, output.take(size));
			staged.push(asset.id);
			variants.push({ ...asset, variant, contentType });
		}
		await output.verifyEnd();
		if (!(await input) || (await closed) !== 0) throw new UploadError('unavailable');
		return { metadata, variants };
	} catch (cause) {
		if (cause instanceof UploadError) throw cause;
		throw new UploadError('unavailable');
	} finally {
		deadline.removeEventListener('abort', stop);
		stop();
		await Promise.all([closed, input]);
	}
}
