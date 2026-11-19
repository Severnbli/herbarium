import { isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { load } from '../../../routes/+page.server.ts';
import { addUser } from '../auth/fixtures.ts';
import { generateId } from '../crypto/tokens.ts';
import { mediaFile, memory } from '../db/schema.ts';
import { createTestDb } from '../testing.ts';
import { loadDashboard } from './dashboard.ts';
import { createEvent } from './events.ts';
import { emptyEventForm } from './schemas.ts';

let fixture: ReturnType<typeof createTestDb>;
beforeEach(() => {
	fixture = createTestDb();
});
afterEach(() => fixture.cleanup());

describe('dashboard', () => {
	it('counts down from the member’s date, compares timed starts as instants and respects precision', async () => {
		const { db } = fixture;
		const actor = await addUser(db, 'alice');
		const plan = { ...emptyEventForm, kind: 'plan', title: 'Synthetic plan' } as const;
		const allDay = createEvent(db, actor, { ...plan, start: '2026-02-28' });
		const timed = { ...plan, dateMode: 'timed', timeZone: 'Asia/Tokyo' } as const;
		const earlier = createEvent(db, actor, { ...timed, start: '2026-03-01T07:00' });
		const later = createEvent(db, actor, { ...timed, start: '2026-03-01T08:45' });
		const approximate = createEvent(db, actor, { ...plan, precision: 'month', start: '2026-03' });
		const daily = createEvent(db, actor, {
			...plan,
			kind: 'occasion',
			repeat: 'custom',
			frequency: 'DAILY',
			start: '2020-02-01'
		});
		const outside = createEvent(db, actor, { ...plan, start: '2026-03-30' });

		const dashboard = loadDashboard(db, 'en', 'America/Los_Angeles', new Date('2026-02-28T23:30Z'));
		expect(dashboard.today).toBe('2026-02-28');
		expect(dashboard.upcoming).toHaveLength(4);
		expect(dashboard.upcoming).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: allDay, days: 0 }),
				expect.objectContaining({
					id: later,
					days: 0,
					label: expect.stringContaining('February 28')
				}),
				expect.objectContaining({ id: approximate, days: null, label: 'March 2026' }),
				expect.objectContaining({ id: daily, days: 0 })
			])
		);
		expect(dashboard.upcoming.some(({ id }) => id === earlier || id === outside)).toBe(false);
	});

	it('highlights the next anniversary beyond the upcoming window and uses the earliest elapsed anchor', async () => {
		const { db } = fixture;
		const actor = await addUser(db, 'alice');
		const anniversary = {
			...emptyEventForm,
			kind: 'occasion',
			occasionType: 'anniversary',
			title: 'Synthetic anniversary'
		} as const;
		createEvent(db, actor, { ...anniversary, start: '2000-09-15' });
		const leapDay = createEvent(db, actor, { ...anniversary, start: '2004-02-29' });
		createEvent(db, actor, { ...anniversary, start: '2027-01-02' });
		createEvent(db, actor, { ...anniversary, occasionType: 'birthday', start: '1999-01-03' });

		const january = loadDashboard(db, 'en', 'UTC', new Date('2026-01-01T12:00Z'));
		expect(january.upcoming.map(({ id }) => id)).not.toContain(leapDay);
		expect(january.nextAnniversary).toMatchObject({
			id: leapDay,
			label: 'February 28, 2026',
			countLabel: '22nd anniversary',
			days: 58
		});
		const onDay = loadDashboard(db, 'en', 'UTC', new Date('2026-02-28T12:00Z'));
		expect(onDay.nextAnniversary).toMatchObject({ id: leapDay, days: 0 });
		expect(onDay.together).toEqual({ since: '2000-09-15', days: 9297 });
		expect(onDay.onThisDay).toEqual([]);
	});

	it('recalls exact original dates from previous years and orders recent memories by upload time', async () => {
		const { db } = fixture;
		const actor = await addUser(db, 'alice');
		const input = { ...emptyEventForm, title: 'Synthetic history' };
		const moment = createEvent(db, actor, { ...input, start: '2011-05-01' });
		const occasion = createEvent(db, actor, { ...input, kind: 'occasion', start: '2012-05-01' });
		createEvent(db, actor, { ...input, kind: 'plan', start: '2015-05-01' });
		createEvent(db, actor, { ...input, precision: 'month', start: '2014-05' });
		createEvent(db, actor, { ...input, start: '2026-05-01' });
		const memoryIds = Array.from({ length: 5 }, (_, index) => {
			const id = generateId();
			db.insert(memory)
				.values({
					id,
					originalName: 'sample.jpg',
					caption: '',
					altText: '',
					createdBy: actor,
					sortDate: `201${9 - index}-05-01`,
					createdAt: new Date(`2026-04-0${index + 1}T12:00Z`)
				})
				.run();
			db.insert(mediaFile)
				.values({
					id: generateId(),
					memoryId: id,
					variant: 'original',
					contentType: 'image/jpeg',
					size: 100,
					wrappedKey: Buffer.alloc(32)
				})
				.run();
			return id;
		});

		const dashboard = loadDashboard(db, 'en', 'UTC', new Date('2026-05-01T12:00Z'));
		expect(dashboard.onThisDay.map(({ id }) => id)).toEqual([occasion, moment]);
		expect(dashboard.memories.map(({ id }) => id)).toEqual(memoryIds.slice(1).reverse());
		expect(dashboard.together).toBeNull();
		expect(dashboard.nextAnniversary).toBeNull();
	});

	it('requires a full session before reading the dashboard', async () => {
		const request = {
			locals: { user: null, session: null, locale: 'en' },
			url: new URL('https://herbarium.example/')
		};
		const result = await Promise.resolve()
			.then(() => load(request as never))
			.catch((reason: unknown) => reason);
		expect(isRedirect(result)).toBe(true);
		expect(result).toMatchObject({ status: 303, location: '/login?next=%2F' });
	});
});
