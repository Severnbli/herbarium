import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../testing.ts';
import { addUser } from '../auth/fixtures.ts';
import { event } from '../db/schema.ts';
import {
	createEvent,
	findEvent,
	listEvents,
	updateEvent,
	completePlan,
	deleteEvent,
	eventToForm,
	PAGE_SIZE
} from './events.ts';
import { emptyEventForm } from './schemas.ts';
let fixture: ReturnType<typeof createTestDb>;
beforeEach(() => {
	fixture = createTestDb();
});
afterEach(() => fixture.cleanup());
const base = {
	...emptyEventForm,
	title: 'A synthetic journey',
	start: '2020-05-01',
	category: 'trip' as const
};
describe('shared events', () => {
	it('creates, edits, filters and deletes without changing author or creation time', async () => {
		const { db } = fixture;
		const alice = await addUser(db, 'alice');
		await addUser(db, 'bob');
		const created = new Date('2020-05-02T12:00Z');
		const id = createEvent(db, alice, { ...base, lat: '0', lon: '-180' }, created);
		expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
		const row = findEvent(db, id);
		expect(row.createdByName).toBe('alice');
		expect(row.startsAt).toBeNull();
		expect(row.startDate).toBe('2020-05-01');
		expect(row.lat).toBe(0);
		updateEvent(db, id, {
			...eventToForm(row),
			title: "New title '); DROP TABLE event;--",
			precision: 'month',
			start: '2021-03',
			lat: '',
			lon: ''
		});
		const edited = findEvent(db, id);
		expect(edited.createdBy).toBe(alice);
		expect(edited.createdAt).toEqual(created);
		expect(edited.startDate).toBe('2021-03-01');
		expect(edited.lat).toBeNull();
		expect(listEvents(db, { year: '2021', kind: 'moment' }).total).toBe(1);
		expect(listEvents(db, { year: '2020' }).total).toBe(0);
		deleteEvent(db, id);
		expect(() => findEvent(db, id)).toThrow('not_found');
	});
	it('stores local year rather than UTC year and round-trips both folds', async () => {
		const { db } = fixture;
		const actor = await addUser(db, 'alice');
		const id = createEvent(db, actor, {
			...base,
			dateMode: 'timed',
			start: '2026-01-01T00:30',
			timeZone: 'Asia/Kathmandu'
		});
		expect(findEvent(db, id).startsAt?.toISOString()).toBe('2025-12-31T18:45:00.000Z');
		expect(listEvents(db, { year: '2026' }).total).toBe(1);
		expect(listEvents(db, { year: '2025' }).total).toBe(0);
		const fold = {
			...base,
			dateMode: 'timed' as const,
			start: '2026-11-01T01:30',
			end: '2026-11-01T01:30',
			timeZone: 'America/New_York',
			disambiguation: 'earlier' as const,
			endDisambiguation: 'later' as const
		};
		updateEvent(db, id, fold);
		expect(eventToForm(findEvent(db, id))).toEqual(fold);
	});
	it('completes a plan in place and prevents early completion through either action or edit', async () => {
		const { db } = fixture;
		const actor = await addUser(db, 'alice');
		const id = createEvent(db, actor, {
			...base,
			kind: 'plan',
			start: '2026-03-01',
			end: '2026-03-03'
		});
		const row = findEvent(db, id);
		const before = new Date('2026-03-03T20:00Z');
		expect(() => completePlan(db, id, before)).toThrow('not_finished');
		expect(() => updateEvent(db, id, { ...eventToForm(row), kind: 'moment' }, before)).toThrow(
			'not_finished'
		);
		completePlan(db, id, new Date('2026-03-04T00:00Z'));
		const completed = findEvent(db, id);
		expect(completed.id).toBe(id);
		expect(completed.kind).toBe('moment');
		expect(completed.createdAt).toEqual(row.createdAt);
		expect(completed.createdBy).toBe(row.createdBy);
		expect(listEvents(db, {}).total).toBe(1);
	});
	it('paginates predictably and caps out-of-range pages', async () => {
		const { db } = fixture;
		const actor = await addUser(db, 'alice');
		for (let i = 0; i < PAGE_SIZE + 2; i++)
			createEvent(db, actor, { ...base, title: `Synthetic ${i}` });
		const first = listEvents(db, { page: '1' });
		const second = listEvents(db, { page: '2' });
		expect(first.rows).toHaveLength(PAGE_SIZE);
		expect(second.rows).toHaveLength(2);
		expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(PAGE_SIZE + 2);
		expect(listEvents(db, { page: '999999' }).page).toBe(2);
	});
	it('keeps content encrypted and rejects invalid data before writes', async () => {
		const { db } = fixture;
		const actor = await addUser(db, 'alice');
		createEvent(db, actor, {
			...base,
			notes: 'Synthetic private notes',
			lat: '53.9',
			lon: '27.5667'
		});
		expect(readFileSync(fixture.path).includes(Buffer.from('Synthetic private notes'))).toBe(false);
		expect(() => createEvent(db, actor, { ...base, lat: '91', lon: '0' })).toThrow();
		expect(listEvents(db, {}).total).toBe(1);
		const row = listEvents(db, {}).rows[0]!;
		expect(() => db.update(event).set({ lat: 100 }).where(eq(event.id, row.id)).run()).toThrow();
		expect(() => findEvent(db, '../bad')).toThrow();
	});
});
