import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, HEAD } from '../../../routes/media/[id]/[variant]/+server.ts';
import { SEGMENT_BYTES } from './format.ts';
import { mediaResponse } from './response.ts';
import { openMediaFile, storeMediaFile } from './store.ts';

const url = 'https://herbarium.example/media/id/original';
const key = randomBytes(32);
const original = Buffer.concat([Buffer.alloc(SEGMENT_BYTES, 42), randomBytes(SEGMENT_BYTES + 27)]);
let dir: string;

async function fixture() {
	return {
		...(await storeMediaFile(dir, key, original.length, [
			original.subarray(0, 777),
			original.subarray(777)
		])),
		memoryId: 'synthetic',
		contentType: 'video/mp4' as const,
		variant: 'original' as const,
		originalName: 'Holiday ✓.mp4'
	};
}

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'herbarium-media-'));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe('encrypted media delivery', () => {
	it('serves full, suffix and cross-segment requests with private typed headers', async () => {
		const asset = await fixture();
		const file = await readFile(join(dir, 'media', asset.id));
		expect(file.includes(original.subarray(0, 256))).toBe(false);
		const full = await mediaResponse(new Request(url), dir, key, asset, true);
		expect(full.status).toBe(200);
		expect(full.headers.get('content-type')).toBe('video/mp4');
		expect(full.headers.get('content-disposition')).toBe(
			'attachment; filename="memory.mp4"; filename*=UTF-8\'\'Holiday%20%E2%9C%93.mp4'
		);
		expect(full.headers.get('cache-control')).toContain('no-store');
		expect(full.headers.get('x-content-type-options')).toBe('nosniff');
		expect(Buffer.from(await full.arrayBuffer()).equals(original)).toBe(true);

		const start = SEGMENT_BYTES - 3;
		const end = SEGMENT_BYTES + 3;
		const partial = await mediaResponse(
			new Request(url, { headers: { range: `bytes=${start}-${end}` } }),
			dir,
			key,
			asset,
			false
		);
		expect(partial.status).toBe(206);
		expect(partial.headers.get('content-range')).toBe(`bytes ${start}-${end}/${original.length}`);
		expect(Buffer.from(await partial.arrayBuffer())).toEqual(original.subarray(start, end + 1));
		const suffix = await mediaResponse(
			new Request(url, { headers: { range: 'bytes=-10' } }),
			dir,
			key,
			asset,
			false
		);
		expect(Buffer.from(await suffix.arrayBuffer())).toEqual(original.subarray(-10));
		const missing = await mediaResponse(
			new Request(url, { headers: { range: `bytes=${original.length}-` } }),
			dir,
			key,
			asset,
			false
		);
		expect(missing.status).toBe(416);
		expect(missing.headers.get('content-range')).toBe(`bytes */${original.length}`);
		const head = await mediaResponse(new Request(url, { method: 'HEAD' }), dir, key, asset, false);
		expect(head.headers.get('content-length')).toBe(String(original.length));
		expect(head.body).toBeNull();
	});

	it('rejects a wrong key, tampered header and truncated file', async () => {
		const asset = await fixture();
		const path = join(dir, 'media', asset.id);
		const file = await readFile(path);
		await expect(
			mediaResponse(new Request(url), dir, randomBytes(32), asset, false)
		).rejects.toSatisfy((cause) => isHttpError(cause, 404));
		await writeFile(path, file.subarray(0, -1));
		await expect(mediaResponse(new Request(url), dir, key, asset, false)).rejects.toSatisfy(
			(cause) => isHttpError(cause, 404)
		);
		file[18] = file.readUInt8(18) ^ 1;
		await writeFile(path, file);
		await expect(mediaResponse(new Request(url), dir, key, asset, false)).rejects.toSatisfy(
			(cause) => isHttpError(cause, 404)
		);
	});

	it('never emits bytes from a tampered segment', async () => {
		const asset = await fixture();
		const path = join(dir, 'media', asset.id);
		const file = await readFile(path);
		file[file.length - 17] = file.readUInt8(file.length - 17) ^ 1;
		await writeFile(path, file);
		const partial = new Request(url, { headers: { range: 'bytes=-27' } });
		await expect(mediaResponse(partial, dir, key, asset, false)).rejects.toSatisfy((cause) =>
			isHttpError(cause, 404)
		);
		const full = await mediaResponse(new Request(url), dir, key, asset, false);
		const reader = full.body!.getReader();
		expect((await reader.read()).value).toEqual(original.subarray(0, SEGMENT_BYTES));
		expect((await reader.read()).value).toEqual(
			original.subarray(SEGMENT_BYTES, SEGMENT_BYTES * 2)
		);
		await expect(reader.read()).rejects.toThrow('Media stream could not be authenticated');
	});

	it('rejects traversal and checks sessions independently for both HTTP methods', async () => {
		expect(() => openMediaFile(dir, '../herbarium.db')).toThrow();
		for (const handler of [GET, HEAD]) {
			const event = { locals: { user: null, session: null }, url: new URL(url) };
			expect(() => handler(event as never)).toThrow(expect.objectContaining({ status: 303 }));
			try {
				handler(event as never);
			} catch (cause) {
				expect(isRedirect(cause)).toBe(true);
			}
		}
	});
});
