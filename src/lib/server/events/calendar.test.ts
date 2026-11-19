import { expect, it } from 'vitest';
import { addUser } from '../auth/fixtures.ts';
import { createTestDb } from '../testing.ts';
import { calendarEntries, calendarWindow } from './calendar.ts';
import { createEvent } from './events.ts';
import { emptyEventForm } from './schemas.ts';

it('starts a week in the active locale and clips the grid to supported dates', () => {
	const week = { view: 'week', date: '2026-11-15' } as const;
	expect(calendarWindow(week, 'en').first).toBe('2026-11-15');
	expect(calendarWindow(week, 'be').first).toBe('2026-11-09');
	expect(calendarWindow(week, 'ru').first).toBe('2026-11-09');
	const boundary = calendarWindow({ view: 'month', date: '0001-01-01' }, 'en');
	expect(boundary.first).toBe('0001-01-01');
	expect(boundary.days[0]).toBeNull();
	expect(boundary.previous).toBeNull();
	expect(boundary.next).toBe('0001-02-01');
});

it('keeps event-local clock dates, exclusive timed ends and ongoing recurring spans', async () => {
	const fixture = createTestDb();
	try {
		const { db } = fixture;
		const actor = await addUser(db, 'alice');
		const timed = createEvent(db, actor, {
			...emptyEventForm,
			title: 'Midnight',
			dateMode: 'timed',
			start: '2024-01-01T00:30',
			end: '2024-01-02T00:00',
			timeZone: 'Asia/Kathmandu'
		});
		const occasion = createEvent(db, actor, {
			...emptyEventForm,
			title: 'Leap-day celebration',
			kind: 'occasion',
			occasionType: 'anniversary',
			start: '2000-02-29',
			end: '2000-03-02'
		});
		expect(calendarEntries(db, '2023-12-31', '2023-12-31', 'en')).toEqual([]);
		expect(calendarEntries(db, '2024-01-01', '2024-01-01', 'en')).toEqual([
			expect.objectContaining({ id: timed, date: '2024-01-01', end: '2024-01-01' })
		]);
		expect(calendarEntries(db, '2025-03-01', '2025-03-01', 'en')).toEqual([
			expect.objectContaining({
				id: occasion,
				date: '2025-02-28',
				end: '2025-03-02',
				occasionCount: '25th anniversary'
			})
		]);
	} finally {
		fixture.cleanup();
	}
});
