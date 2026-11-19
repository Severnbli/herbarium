import { describe, expect, it } from 'vitest';
import { localToInstant } from '#lib/domain/event-date.ts';
import { describeOccasion } from './occasion-labels.ts';
import { expandOccasion, recurrenceRule, type RecurringEvent } from './recurrence.ts';

const annual: RecurringEvent = {
	dateMode: 'date',
	precision: 'day',
	startDate: '2000-02-29',
	endDate: null,
	startsAt: null,
	endsAt: null,
	timeZone: null,
	recurrenceRule: recurrenceRule('YEARLY', 1),
	occasionType: 'anniversary'
};

describe('occasion recurrence', () => {
	it.each([
		['2000', '29', 0],
		['2023', '28', 23],
		['2024', '29', 24],
		['2100', '28', 100]
	])('uses the final day of February in %s', (year, day, count) => {
		expect(expandOccasion(annual, `${year}-02-01`, `${year}-03-01`)).toMatchObject([
			{ date: `${year}-02-${day}`, count }
		]);
	});

	it('includes both endpoints and excludes dates before the anchor or between periods', () => {
		const event = { ...annual, recurrenceRule: recurrenceRule('WEEKLY', 2) };
		expect(expandOccasion(event, '2000-02-28', '2000-03-14').map((item) => item.date)).toEqual([
			'2000-02-29',
			'2000-03-14'
		]);
		expect(expandOccasion(event, '2000-03-01', '2000-03-13')).toEqual([]);
		expect(expandOccasion(event, '1999-12-01', '2000-02-28')).toEqual([]);
		expect(() => expandOccasion(event, '2001-01-01', '2000-01-01')).toThrow(RangeError);
		expect(() => expandOccasion(event, '2000-01-01', '2002-01-01')).toThrow(RangeError);
	});

	it('skips short months and preserves an all-day span and custom interval', () => {
		const event = {
			...annual,
			startDate: '0099-01-31',
			endDate: '0099-02-02',
			recurrenceRule: recurrenceRule('MONTHLY', 2)
		};
		expect(
			expandOccasion(event, '0099-03-01', '0099-10-01').map(({ date, value }) => [
				date,
				value.endDate
			])
		).toEqual([
			['0099-03-31', '0099-04-02'],
			['0099-05-31', '0099-06-02'],
			['0099-07-31', '0099-08-02']
		]);
	});

	it('preserves wall time across DST, skips gaps and keeps the timed duration', () => {
		const timeZone = 'America/New_York';
		const event: RecurringEvent = {
			...annual,
			dateMode: 'timed',
			startDate: null,
			startsAt: localToInstant('2026-03-07T02:30', timeZone),
			endsAt: localToInstant('2026-03-07T03:30', timeZone),
			timeZone,
			recurrenceRule: recurrenceRule('DAILY', 1)
		};
		expect(
			expandOccasion(event, '2026-03-07', '2026-03-09').map(({ value }) => [
				value.startsAt!.toISOString(),
				value.endsAt!.toISOString()
			])
		).toEqual([
			['2026-03-07T07:30:00.000Z', '2026-03-07T08:30:00.000Z'],
			['2026-03-09T06:30:00.000Z', '2026-03-09T07:30:00.000Z']
		]);
		const laterFold = localToInstant('2026-11-01T01:30', timeZone, 'later');
		expect(
			expandOccasion(
				{
					...event,
					startsAt: laterFold,
					endsAt: null,
					recurrenceRule: recurrenceRule('WEEKLY', 1)
				},
				'2026-11-01',
				'2026-11-01'
			)[0]?.value.startsAt
		).toEqual(laterFold);
	});

	it.each([
		['en', '21st anniversary', 'Turns 21'],
		['be', '21-я гадавіна', 'Узрост: 21'],
		['ru', '21-я годовщина', 'Возраст: 21']
	] as const)('localizes anniversary and birthday counts in %s', (locale, ordinal, age) => {
		const now = new Date('2021-02-01T12:00Z');
		expect(describeOccasion(locale, annual, now).upcoming[0]?.label).toBe(ordinal);
		expect(
			describeOccasion(locale, { ...annual, occasionType: 'birthday' }, now).upcoming[0]?.label
		).toBe(age);
	});

	it.each([
		[1, '1st'],
		[2, '2nd'],
		[3, '3rd'],
		[11, '11th'],
		[12, '12th'],
		[13, '13th']
	])('uses the correct English ordinal for %s', (count, ordinal) => {
		const now = new Date(`${2000 + count}-02-01T12:00Z`);
		expect(describeOccasion('en', annual, now).upcoming[0]?.label).toBe(`${ordinal} anniversary`);
	});
});
