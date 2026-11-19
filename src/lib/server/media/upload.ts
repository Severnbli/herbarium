import { type Hmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Busboy from '@fastify/busboy';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Config } from '#lib/server/config.ts';
import { generateId } from '#lib/server/crypto/tokens.ts';
import type { Db } from '#lib/server/db/index.ts';
import {
	event,
	importReceipt,
	mediaFile,
	memory,
	memoryFingerprint
} from '#lib/server/db/schema.ts';
import { mediaFingerprintKey, newMediaFingerprint } from './fingerprint.ts';
import { checkImportFile, ImportError, isDuplicate, requireImport } from './imports.ts';
import { processMedia, UploadError } from './process.ts';
import { removeMediaFile } from './store.ts';

export const description = {
	altText: z.string().trim().max(280),
	caption: z.string().trim().max(1000)
};
const fieldsSchema = z.strictObject(description);
const filename = z.string().min(1).max(255);
let uploadInProgress = false;

interface ImportTarget {
	id: string;
	fingerprint: string;
	sessionActive: () => boolean;
}

interface UploadedMemory {
	id: string;
	coordinates: { lat: number; lon: number } | null;
	status: 'uploaded';
}

type UploadResult = UploadedMemory | { status: 'saved' | 'duplicate' };
type UploadInstance = { db: Db; config: Config; wrappingKey: Buffer };

export function uploadMemory(
	request: Request,
	instance: UploadInstance,
	actorId: string,
	eventId: null,
	target: ImportTarget
): Promise<UploadResult>;
export function uploadMemory(
	request: Request,
	instance: UploadInstance,
	actorId: string,
	eventId: string | null
): Promise<UploadedMemory>;
export async function uploadMemory(
	request: Request,
	instance: UploadInstance,
	actorId: string,
	eventId: string | null,
	importTarget?: ImportTarget
): Promise<UploadResult> {
	const { db, config, wrappingKey } = instance;
	const { maxFileBytes, maxRequestBytes } = config.limits;
	const contentType = request.headers.get('content-type');
	if (!request.body || !contentType?.toLowerCase().startsWith('multipart/form-data;')) {
		throw new UploadError('invalid');
	}
	const declared = request.headers.get('content-length');
	if (declared !== null) {
		if (!/^\d{1,20}$/.test(declared)) throw new UploadError('invalid');
		if (Number(declared) > maxRequestBytes) throw new UploadError('size');
	}
	if (uploadInProgress) throw new UploadError('busy');

	const parser = makeParser(contentType, maxFileBytes);
	const hash = newMediaFingerprint(mediaFingerprintKey(db));
	const controller = new AbortController();
	const signal = AbortSignal.any([
		request.signal,
		controller.signal,
		AbortSignal.timeout(6 * 60_000)
	]);
	const fields = Object.create(null) as Record<string, string>;
	const staged: string[] = [];
	let originalName = '';
	let processing: Promise<Awaited<ReturnType<typeof processMedia>> | undefined> | undefined;
	let problem: UploadError | undefined;
	parser.on('field', (name, value, truncatedName, truncatedValue) => {
		if (truncatedName || truncatedValue || Object.hasOwn(fields, name)) {
			problem ??= new UploadError('invalid');
		}
		fields[name] = value;
	});
	parser.on('file', (name, stream, fileName, encoding) => {
		stream.on('error', () => undefined);
		stream.on('limit', () => {
			problem = new UploadError('size');
		});
		if (
			name !== 'file' ||
			!filename.safeParse(fileName).success ||
			!['7bit', 'binary', '8bit'].includes(encoding)
		) {
			problem ??= new UploadError('invalid');
			stream.resume();
			return;
		}
		originalName = fileName;
		const source = Readable.from(fingerprintBytes(stream, hash), { objectMode: false });
		processing = processMedia(source, config, wrappingKey, signal, staged).catch(
			(cause: unknown) => {
				problem ??= cause instanceof UploadError ? cause : new UploadError('unavailable');
				controller.abort();
				return undefined;
			}
		);
	});
	for (const name of ['fieldsLimit', 'filesLimit', 'partsLimit'] as const) {
		parser.on(name, () => {
			problem ??= new UploadError('invalid');
		});
	}

	uploadInProgress = true;
	try {
		try {
			await pipeline(boundedBody(request.body, maxRequestBytes), parser, { signal });
		} catch (cause) {
			if (cause instanceof UploadError) problem = cause;
			throw problem ?? new UploadError('invalid');
		}
		if (problem) throw problem;
		const parsed = fieldsSchema.safeParse(fields);
		if (!parsed.success || !processing) throw new UploadError('invalid');
		const processed = await processing;
		if (!processed || problem) throw problem ?? new UploadError('unavailable');
		const { metadata, variants } = processed;
		const id = generateId();
		const digest = hash.digest('hex');
		const now = new Date();
		const status = db.transaction(
			(tx) => {
				if (importTarget) {
					if (!importTarget.sessionActive()) throw new ImportError('session');
					requireImport(tx, importTarget.id, actorId);
					const previous = checkImportFile(tx, importTarget.id, importTarget.fingerprint);
					if (previous) return previous;
					if (isDuplicate(tx, digest)) {
						tx.insert(importReceipt)
							.values({
								importId: importTarget.id,
								fingerprint: importTarget.fingerprint,
								duplicate: true
							})
							.run();
						return 'duplicate';
					}
				}
				if (
					eventId &&
					!tx.select({ id: event.id }).from(event).where(eq(event.id, eventId)).get()
				) {
					throw new UploadError('invalid');
				}
				tx.insert(memory)
					.values({
						id,
						eventId,
						originalName,
						...parsed.data,
						captureDate: metadata.captureDate,
						sortDate: metadata.captureDate ?? now.toISOString().slice(0, 10),
						createdBy: actorId,
						createdAt: now
					})
					.run();
				tx.insert(mediaFile)
					.values(variants.map((file) => ({ ...file, memoryId: id })))
					.run();
				tx.insert(memoryFingerprint).values({ memoryId: id, digest }).run();
				if (importTarget) {
					tx.insert(importReceipt)
						.values({
							importId: importTarget.id,
							fingerprint: importTarget.fingerprint,
							memoryId: id,
							duplicate: false
						})
						.run();
				}
				return 'uploaded';
			},
			{ behavior: 'immediate' }
		);
		if (status !== 'uploaded') return { status };
		staged.length = 0;
		return {
			id,
			status,
			coordinates:
				metadata.lat !== null && metadata.lon !== null
					? { lat: metadata.lat, lon: metadata.lon }
					: null
		};
	} finally {
		controller.abort();
		await processing;
		await Promise.allSettled(staged.map((id) => removeMediaFile(config.dataDir, id)));
		uploadInProgress = false;
	}
}

async function* fingerprintBytes(source: Readable, hash: Hmac) {
	for await (const bytes of source) {
		const chunk = bytes as Buffer;
		hash.update(chunk);
		yield chunk;
	}
}

async function* boundedBody(body: ReadableStream<Uint8Array>, limit: number) {
	const reader = body.getReader();
	let size = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) return;
			size += value.length;
			if (size > limit) throw new UploadError('size');
			yield value;
		}
	} finally {
		// Releasing the reader lets adapter-node drain the request and deliver the error response.
		reader.releaseLock();
	}
}

function makeParser(contentType: string, maxFileBytes: number) {
	try {
		return new Busboy({
			headers: { 'content-type': contentType },
			limits: {
				files: 1,
				fields: 2,
				parts: 4,
				fileSize: maxFileBytes,
				fieldSize: 4096,
				fieldNameSize: 32,
				headerSize: 8192
			}
		});
	} catch {
		throw new UploadError('invalid');
	}
}
