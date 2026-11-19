import { isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { load } from '../../../routes/timeline/+page.server.ts';
import { addUser } from '../auth/fixtures.ts';
import { generateId } from '../crypto/tokens.ts';
import { memory } from '../db/schema.ts';
import { createTestDb } from '../testing.ts';
import { createEvent, deleteEvent } from './events.ts';
import { emptyEventForm } from './schemas.ts';
import { listTimeline, timelineQuery } from './timeline.ts';

let fixture: ReturnType<typeof createTestDb>;
beforeEach(() => {
	fixture = createTestDb();
});
afterEach(() => fixture.cleanup());

describe('timeline', () => {
	it('paginates both ways across tied dates and survives deletion of a cursor anchor', async () => {
		const { db } = fixture;
		const actor = await addUser(db, 'alice');
		const input = { ...emptyEventForm, title: 'A synthetic moment', start: '2020-03-01' };
		const ids = Array.from({ length: 53 }, () => createEvent(db, actor, input))
			.sort()
			.reverse();
		const first = listTimeline(db, {});
		expect(first.rows.map(({ id }) => id)).toEqual(ids.slice(0, 24));
		expect(first.newer).toBeNull();
		const middle = listTimeline(db, { older: first.older! });
		expect(middle.rows.map(({ id }) => id)).toEqual(ids.slice(24, 48));
		const last = listTimeline(db, { older: middle.older! });
		expect(last.rows.map(({ id }) => id)).toEqual(ids.slice(48));
		expect(last.older).toBeNull();
		expect(listTimeline(db, { newer: last.newer! })).toEqual(middle);
		const back = listTimeline(db, { newer: middle.newer! });
		expect(back).toMatchObject({ rows: first.rows, newer: null, older: first.older });

		deleteEvent(db, first.rows.at(-1)!.id);
		expect(listTimeline(db, { older: first.older! }).rows).toEqual(middle.rows);
	});

	it('combines filters and picks one preview from the event’s attachments', async () => {
		const { db } = fixture;
		const actor = await addUser(db, 'alice');
		const input = { ...emptyEventForm, title: 'A synthetic trip', start: '2020-03-01' };
		const trip = createEvent(db, actor, { ...input, category: 'trip' });
		const plan = createEvent(db, actor, { ...input, category: 'trip', kind: 'plan' });
		const uncategorized = createEvent(db, actor, { ...input, start: '2019', precision: 'year' });
		const occasion = createEvent(db, actor, {
			...input,
			kind: 'occasion',
			dateMode: 'timed',
			start: '2020-01-01T00:30',
			timeZone: 'Asia/Kathmandu'
		});
		const preview = generateId();
		const attachment = { originalName: 'sample.jpg', caption: '', altText: '', createdBy: actor };
		db.insert(memory)
			.values([
				{ ...attachment, id: generateId(), eventId: trip, sortDate: '2020-03-01' },
				{ ...attachment, id: preview, eventId: trip, sortDate: '2020-03-02', altText: 'A leaf' },
				{ ...attachment, id: generateId(), eventId: plan, sortDate: '2020-03-03' },
				{ ...attachment, id: generateId(), sortDate: '2020-03-04' }
			])
			.run();

		const filtered = listTimeline(db, { kind: 'moment', category: 'trip' });
		expect(filtered.rows).toHaveLength(1);
		expect(filtered.rows[0]).toMatchObject({
			id: trip,
			preview: { id: preview, altText: 'A leaf' }
		});
		expect(listTimeline(db, { kind: 'moment', category: 'none' }).rows).toMatchObject([
			{ id: uncategorized, precision: 'year', preview: null }
		]);
		expect(listTimeline(db, { kind: 'occasion' }).rows).toMatchObject([
			{ id: occasion, sortDate: '2020-01-01', startsAt: new Date('2019-12-31T18:45Z') }
		]);
	});

	it('rejects invalid dates, conflicting cursors and unknown filters', () => {
		const anchor = `2020-02-29.${generateId()}`;
		expect(timelineQuery.safeParse({ older: anchor }).success).toBe(true);
		for (const query of [
			{ older: anchor, newer: anchor },
			{ older: anchor.replace('2020', '2021') },
			{ older: anchor.replace('2020', '0000') },
			{ newer: 'invalid' },
			{ category: 'unknown' },
			{ year: '2020' }
		]) {
			expect(timelineQuery.safeParse(query).success).toBe(false);
		}
	});

	it('checks for a session before attempting to load the timeline', async () => {
		const request = {
			locals: { user: null, session: null, locale: 'en' },
			url: new URL('https://herbarium.example/timeline')
		};
		const result = await Promise.resolve()
			.then(() => load(request as never))
			.catch((reason: unknown) => reason);
		expect(isRedirect(result)).toBe(true);
		expect(result).toMatchObject({ status: 303, location: '/login?next=%2Ftimeline' });
	});
});
