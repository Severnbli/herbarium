import { renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { coordinatePair } from '#lib/domain/location.ts';
import { load as mapLoad } from '../../../routes/map/+page.server.ts';
import {
	GET as assetsGet,
	HEAD as assetsHead
} from '../../../routes/map/assets/[...asset]/+server.ts';
import { POST as searchPost } from '../../../routes/map/search/+server.ts';
import { addUser } from '../auth/fixtures.ts';
import { createEvent } from '../events/events.ts';
import { emptyEventForm } from '../events/schemas.ts';
import { createTestDb } from '../testing.ts';
import { hasBasemap, mapAssetResponse, tileArchive } from './assets.ts';
import { listPinnedEvents, mapFilters } from './events.ts';
import { searchPlaces } from './gazetteer.ts';

describe('offline maps', () => {
	it('serves exact byte ranges and excludes files outside the map asset allowlist', async () => {
		const fixture = createTestDb();
		const archive = join(fixture.dir, tileArchive);
		const request = (asset: string, headers?: HeadersInit, method = 'GET') =>
			mapAssetResponse(
				new Request('https://example.test/map/assets/' + asset, { method, headers }),
				fixture.dir,
				{ asset }
			);
		try {
			expect(await hasBasemap(fixture.dir)).toBe(false);
			symlinkSync(fixture.path, archive);
			expect(await hasBasemap(fixture.dir)).toBe(false);
			await expect(request(tileArchive)).rejects.toMatchObject({ status: 404 });
			const data = Buffer.from('PMTiles\x03abcdefgh');
			writeFileSync(join(fixture.dir, 'regular-archive'), data);
			await expect(request('gazetteer.sqlite')).rejects.toMatchObject({ status: 404 });
			await expect(request('../' + tileArchive)).rejects.toMatchObject({ status: 404 });
			await expect(request('glyphs/Noto Sans Regular/1-256.pbf')).rejects.toMatchObject({
				status: 404
			});

			renameSync(join(fixture.dir, 'regular-archive'), archive);
			expect(await hasBasemap(fixture.dir)).toBe(true);
			const response = await request(tileArchive, { range: 'bytes=8-10' });
			expect(response.status).toBe(206);
			expect(response.headers.get('content-range')).toBe('bytes 8-10/16');
			expect(response.headers.get('cache-control')).toContain('no-store');
			expect(await response.text()).toBe('abc');
			const etag = response.headers.get('etag');
			expect(etag).toBeTruthy();
			const head = await request(tileArchive, { range: 'bytes=8-10' }, 'HEAD');
			expect(head.headers.get('content-length')).toBe('16');
			expect(head.headers.get('etag')).toBe(etag);
			expect(head.body).toBeNull();
			const stale = await request(tileArchive, { range: 'bytes=8-10', 'if-range': '"stale"' });
			expect(stale.status).toBe(200);
			expect(Buffer.from(await stale.arrayBuffer())).toEqual(data);
			const unsatisfiable = await request(tileArchive, { range: 'bytes=16-' });
			expect(unsatisfiable.status).toBe(416);
			expect(unsatisfiable.headers.get('content-range')).toBe('bytes */16');
		} finally {
			fixture.cleanup();
		}
	});

	it.each([mapLoad, assetsGet, assetsHead, searchPost])(
		'checks the session at the route boundary',
		async (handler) => {
			const result = await Promise.resolve()
				.then(() =>
					handler({
						locals: { user: null, session: null, locale: 'en' },
						url: new URL('https://example.test/map')
					} as never)
				)
				.catch((reason: unknown) => reason);
			expect(isRedirect(result)).toBe(true);
			expect(result).toMatchObject({ status: 303, location: '/login?next=%2Fmap' });
		}
	);

	it('finds public places through alternate spellings and returns localized display names', () => {
		expect(searchPlaces('Minsk', 'be')[0]).toMatchObject({ name: 'Мінск', country: 'BY' });
		expect(searchPlaces('Мінск', 'ru')[0]).toMatchObject({ name: 'Минск', country: 'BY' });
		expect(searchPlaces('Минск', 'en')[0]).toMatchObject({ name: 'Minsk', country: 'BY' });
		expect(searchPlaces('Zurich', 'en')[0]).toMatchObject({ country: 'CH' });
		expect(searchPlaces('") OR * /', 'en')).toEqual(searchPlaces('OR', 'en'));
		expect(searchPlaces('") * /', 'en')).toEqual([]);
	});

	it('uses the same coordinate bounds for pasted pairs and the event form', () => {
		expect(coordinatePair(' -90.0, +180 ')).toEqual({ lat: -90, lon: 180 });
		expect(coordinatePair('0 0')).toEqual({ lat: 0, lon: 0 });
		for (const value of ['91,0', '0,-180.1', '1e1,0', '0,Infinity', '0', '1,2,3'])
			expect(coordinatePair(value)).toBeNull();
	});

	it('filters pinned events by their original local year, kind and category', async () => {
		const fixture = createTestDb();
		try {
			const actor = await addUser(fixture.db, 'alice');
			const input = {
				...emptyEventForm,
				title: 'A synthetic pin',
				start: '2020-01-01',
				category: 'trip'
			} as const;
			const pinned = createEvent(fixture.db, actor, { ...input, lat: '0', lon: '0' });
			createEvent(fixture.db, actor, input);
			createEvent(fixture.db, actor, { ...input, lat: '0', lon: '50', start: '2019-12-31' });
			createEvent(fixture.db, actor, { ...input, lat: '0', lon: '50', kind: 'plan' });
			createEvent(fixture.db, actor, { ...input, lat: '0', lon: '50', category: 'date' });

			expect(listPinnedEvents(fixture.db, mapFilters.parse({}))).toHaveLength(4);
			const filters = mapFilters.parse({ year: '2020', kind: 'moment', category: 'trip' });
			expect(listPinnedEvents(fixture.db, filters)).toMatchObject([{ id: pinned, lat: 0, lon: 0 }]);
		} finally {
			fixture.cleanup();
		}
	});
});
