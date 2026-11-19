import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { parseRange } from '#lib/server/http/byte-range.ts';

export const mapAssetDir = resolve('map-assets');
export const tileArchive = 'basemap.pmtiles';
const assetPath = z.strictObject({
	asset: z.string().max(64)
});
const sprites = new Map([
	['markers.json', 'application/json'],
	['markers.png', 'image/png'],
	['markers@2x.json', 'application/json'],
	['markers@2x.png', 'image/png']
]);

const openAsset = (path: string) =>
	open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

export async function hasBasemap(dataDir: string) {
	try {
		const file = await openAsset(join(dataDir, tileArchive));
		try {
			const header = Buffer.alloc(8);
			return (
				(await file.stat()).isFile() &&
				(await file.read(header)).bytesRead === header.length &&
				header.subarray(0, 7).toString() === 'PMTiles' &&
				header[7] === 3
			);
		} finally {
			await file.close();
		}
	} catch {
		return false;
	}
}

export async function mapAssetResponse(
	request: Request,
	dataDir: string,
	params: Record<string, string | undefined>
) {
	const parsed = assetPath.safeParse(params);
	if (!parsed.success || new URL(request.url).search) error(404, 'Map asset unavailable');
	const { asset } = parsed.data;
	const spriteType = sprites.get(asset);
	const glyph = /^glyphs\/Noto Sans Regular\/(\d{1,5})-(\d{1,5})\.pbf$/.exec(asset);
	const validGlyph =
		glyph &&
		Number(glyph[1]) % 256 === 0 &&
		Number(glyph[2]) === Number(glyph[1]) + 255 &&
		Number(glyph[2]) <= 65535;

	const archive = asset === tileArchive;
	const contentType = archive
		? 'application/octet-stream'
		: (spriteType ?? (validGlyph ? 'application/x-protobuf' : null));
	if (!contentType) error(404, 'Map asset unavailable');

	const headers = new Headers({
		'accept-ranges': 'bytes',
		'cache-control': 'private, no-store, no-transform',
		'content-type': contentType,
		'x-content-type-options': 'nosniff'
	});
	const path = archive
		? join(dataDir, tileArchive)
		: join(mapAssetDir, validGlyph ? `glyphs/${Number(glyph[1])}-${Number(glyph[2])}.pbf` : asset);
	let file: Awaited<ReturnType<typeof open>> | undefined;
	try {
		file = await openAsset(path);
		const stat = await file.stat({ bigint: true });
		if (!stat.isFile() || stat.size > BigInt(Number.MAX_SAFE_INTEGER))
			error(404, 'Map asset unavailable');
		const size = Number(stat.size);
		const etag = `"${stat.dev}-${stat.ino}-${stat.size}-${stat.mtimeNs}"`;
		headers.set('etag', etag);
		const ifRange = request.headers.get('if-range');
		const range = parseRange(
			request.method === 'HEAD' || (ifRange && ifRange !== etag)
				? null
				: request.headers.get('range'),
			size
		);
		if (range === false) {
			headers.set('content-range', `bytes */${size}`);
			return new Response(null, { status: 416, headers });
		}
		const { start, end } = range ?? { start: 0, end: size - 1 };
		headers.set('content-length', String(end - start + 1));
		if (range) headers.set('content-range', `bytes ${start}-${end}/${size}`);
		if (request.method === 'HEAD' || size === 0) return new Response(null, { headers });

		const stream = file.createReadStream({ start, end });
		file = undefined; // The stream owns the file descriptor until EOF or cancellation.
		// Node's stream/web and DOM declarations differ on the BYOB overloads.
		const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
		return new Response(body, { status: range ? 206 : 200, headers });
	} catch (cause) {
		if (validGlyph && cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') {
			// This font has no glyphs in that Unicode block.
			return new Response(null, { headers });
		}
		error(404, 'Map asset unavailable');
	} finally {
		await file?.close();
	}
}
