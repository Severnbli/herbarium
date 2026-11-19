import { describe, expect, it } from 'vitest';
import {
	normalizeDate,
	localToInstant,
	instantToLocal,
	disambiguationFor,
	formatEventDate,
	hasHappened,
	validTimeZone,
	type EventDate
} from './event-date.ts';

const date = (
	startDate: string,
	precision: EventDate['precision'] = 'day',
	endDate: string | null = null
): EventDate => ({
	dateMode: 'date',
	precision,
	startDate,
	endDate,
	startsAt: null,
	endsAt: null,
	timeZone: null
});

describe('event dates', () => {
	it.each([
		['2024-02-29', 'day', '2024-02-29'],
		['2020-03', 'month', '2020-03-01'],
		['0001', 'year', '0001-01-01'],
		['9999', 'year', '9999-01-01']
	] as const)('normalizes %s', (input, precision, expected) => {
		expect(normalizeDate(input, precision)).toBe(expected);
	});
	it.each([
		'2023-02-29',
		'2024-04-31',
		'0000-01-01',
		'2024-2-01',
		'2024-01-32',
		'2024-13-01',
		'2024-01-01T00:00Z'
	])('rejects impossible or noncanonical date %s', (value) => {
		expect(() => normalizeDate(value, 'day')).toThrow();
	});
	it('formats approximate dates and ranges without inventing days', () => {
		expect(formatEventDate('en', date('2020-03-01', 'month'))).toBe('March 2020');
		expect(formatEventDate('en', date('2019-01-01', 'year'))).toBe('2019');
		expect(formatEventDate('en', date('2024-02-29'))).toBe('February 29, 2024');
		expect(formatEventDate('be', date('2020-03-01', 'month'))).toContain('сакавік');
		expect(formatEventDate('ru', date('2024-02-29'))).toContain('29 февраля');
		expect(formatEventDate('en', date('2020-03-01', 'month', '2020-04-01'))).toBe(
			'March 2020 – April 2020'
		);
	});
	it('converts local dates independently of the server time zone', () => {
		expect(localToInstant('2026-01-01T00:30', 'Asia/Kathmandu').toISOString()).toBe(
			'2025-12-31T18:45:00.000Z'
		);
		expect(localToInstant('2026-01-01T00:30', 'America/New_York').toISOString()).toBe(
			'2026-01-01T05:30:00.000Z'
		);
		expect(instantToLocal(new Date('2025-12-31T18:45Z'), 'Asia/Kathmandu')).toBe(
			'2026-01-01T00:30'
		);
		expect(validTimeZone('+03:00')).toBe(false);
		expect(validTimeZone('No/Such_Zone')).toBe(false);
		expect(validTimeZone('UTC')).toBe(true);
	});
	it('rejects DST gaps even with a fold choice', () => {
		for (const choice of ['reject', 'earlier', 'later'] as const) {
			expect(() => localToInstant('2026-03-08T02:30', 'America/New_York', choice)).toThrow();
		}
	});
	it('requires a fold choice and preserves either instant on edit', () => {
		expect(() => localToInstant('2026-11-01T01:30', 'America/New_York')).toThrow();
		const earlier = localToInstant('2026-11-01T01:30', 'America/New_York', 'earlier');
		const later = localToInstant('2026-11-01T01:30', 'America/New_York', 'later');
		expect(earlier.toISOString()).toBe('2026-11-01T05:30:00.000Z');
		expect(later.toISOString()).toBe('2026-11-01T06:30:00.000Z');
		expect(disambiguationFor(earlier, 'America/New_York')).toBe('earlier');
		expect(disambiguationFor(later, 'America/New_York')).toBe('later');
	});
	it('requires the full date-only period or timed interval to have elapsed', () => {
		expect(hasHappened(date('2026-01-01'), new Date('2026-01-01T23:59Z'))).toBe(false);
		expect(hasHappened(date('2026-01-01'), new Date('2026-01-02T00:00Z'))).toBe(true);
		expect(hasHappened(date('2024-02-01', 'month'), new Date('2024-02-29T23:59Z'))).toBe(false);
		expect(hasHappened(date('2024-02-01', 'month'), new Date('2024-03-01T00:00Z'))).toBe(true);
		expect(hasHappened(date('2025-01-01', 'year'), new Date('2026-01-01T00:00Z'))).toBe(true);
		expect(hasHappened(date('9999-01-01', 'year'), new Date('2026-01-01T00:00Z'))).toBe(false);
		expect(
			hasHappened(date('2026-01-01', 'day', '2026-01-05'), new Date('2026-01-03T00:00Z'))
		).toBe(false);
		const timed: EventDate = {
			...date('2026-01-01'),
			dateMode: 'timed',
			startDate: null,
			timeZone: 'UTC',
			startsAt: new Date('2026-01-01T10:00Z'),
			endsAt: new Date('2026-01-01T12:00Z')
		};
		expect(hasHappened(timed, new Date('2026-01-01T11:00Z'))).toBe(false);
		expect(hasHappened(timed, new Date('2026-01-01T12:00Z'))).toBe(true);
	});
});
