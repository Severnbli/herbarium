import { error } from '@sveltejs/kit';
import { unwrapDataKey } from '#lib/server/crypto/keys.ts';
import type { mediaFile } from '#lib/server/db/schema.ts';
import { openMedia, type ByteRange } from './format.ts';
import { openMediaFile } from './store.ts';

export const MEDIA_EXTENSIONS = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/heic': 'heic',
	'video/mp4': 'mp4',
	'video/quicktime': 'mov'
} as const;

// A single range is enough for browser playback. Unknown units are ignored per HTTP semantics.
function parseRange(value: string | null, size: number): ByteRange | null | false {
	if (!value?.toLowerCase().startsWith('bytes=')) return null;
	const match = /^bytes=(\d{0,20})-(\d{0,20})$/i.exec(value);
	if (!match || (!match[1] && !match[2])) return false;
	if (!match[1]) {
		const suffix = Number(match[2]);
		return suffix > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : false;
	}
	const start = Number(match[1]);
	const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
	return start < size && end >= start ? { start, end } : false;
}

function disposition(attachment: boolean, name: string, extension: string): string {
	const fallback = `memory.${extension}`;
	const stem = name
		// Control bytes must never reach Content-Disposition.
		// eslint-disable-next-line no-control-regex
		.replace(/[\\/:\u0000-\u001f\u007f]/gu, '_')
		.replace(/\.[^.]*$/, '')
		.trim();
	const encoded = encodeURIComponent(
		(stem ? `${stem}.${extension}` : fallback).toWellFormed()
	).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
	return `${attachment ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function mediaResponse(
	request: Request,
	dataDir: string,
	wrappingKey: Buffer,
	asset: typeof mediaFile.$inferSelect & { originalName: string },
	download: boolean
): Promise<Response> {
	const { size, contentType } = asset;
	const headers = new Headers({
		'accept-ranges': 'bytes',
		'cache-control': 'private, no-store, no-transform',
		'x-content-type-options': 'nosniff',
		'content-type': contentType,
		'content-disposition': disposition(
			download || contentType === 'image/heic',
			asset.originalName,
			MEDIA_EXTENSIONS[contentType]
		)
	});
	const range = parseRange(
		request.method === 'HEAD' || request.headers.has('if-range')
			? null
			: request.headers.get('range'),
		size
	);
	let dataKey: Buffer | undefined;
	let file: Awaited<ReturnType<typeof openMediaFile>> | undefined;
	let streaming = false;
	try {
		const key = unwrapDataKey(wrappingKey, asset.wrappedKey, `media:${asset.id}`);
		dataKey = key;
		file = await openMediaFile(dataDir, asset.id);
		const read = await openMedia(file, key, size);
		if (range === false) {
			headers.set('content-range', `bytes */${size}`);
			return new Response(null, { headers, status: 416 });
		}
		const { start, end } = range ?? { start: 0, end: size - 1 };
		headers.set('content-length', String(end - start + 1));
		if (range) headers.set('content-range', `bytes ${start}-${end}/${size}`);
		if (request.method === 'HEAD') return new Response(null, { headers });

		const iterator = read({ start, end });
		// Verify the first requested segment before committing status and headers.
		let segment = await iterator.next();
		const handle = file;
		let closing: Promise<void> | undefined;
		const dispose = async () => {
			await iterator.return(undefined);
			key.fill(0);
			await handle.close();
		};
		const close = () => (closing ??= dispose());
		const body = new ReadableStream<Uint8Array>({
			async pull(controller) {
				try {
					if (segment.done) segment = await iterator.next();
					if (segment.done) {
						await close();
						controller.close();
						return;
					}
					controller.enqueue(segment.value);
					segment = { done: true, value: undefined };
				} catch {
					await close();
					controller.error(new Error('Media stream could not be authenticated'));
				}
			},
			cancel: close
		});
		const response = new Response(body, { headers, status: range ? 206 : 200 });
		streaming = true;
		return response;
	} catch {
		throw error(404, 'Media unavailable');
	} finally {
		if (!streaming) {
			dataKey?.fill(0);
			await file?.close();
		}
	}
}
