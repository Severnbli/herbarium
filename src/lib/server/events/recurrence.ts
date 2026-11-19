import { Temporal } from '@js-temporal/polyfill';
import rrule from 'rrule';
import {
	instantToLocal,
	localToInstant,
	normalizeDate,
	type EventDate
} from '#lib/domain/event-date.ts';

const { RRule } = rrule;
export const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const;
type Frequency = (typeof FREQUENCIES)[number];
export const OCCASION_TYPES = ['general', 'anniversary', 'birthday'] as const;
type OccasionType = (typeof OCCASION_TYPES)[number];

export type RecurringEvent = EventDate & {
	recurrenceRule: string;
	occasionType: OccasionType;
};

export function recurrenceRule(frequency: Frequency, interval: number) {
	return `FREQ=${frequency};INTERVAL=${interval}`;
}

export function readRecurrence(rule: string) {
	const match = /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY);INTERVAL=([1-9]\d?)$/.exec(rule);
	if (!match) throw new RangeError('Invalid recurrence rule');
	return { frequency: match[1] as Frequency, interval: Number(match[2]) };
}

export function originalLocalStart(event: EventDate) {
	return event.startsAt && event.timeZone
		? instantToLocal(event.startsAt, event.timeZone)
		: event.startDate!;
}

export function validateOccurrenceRange(from: string, through: string) {
	const start = Temporal.PlainDate.from(normalizeDate(from, 'day'));
	const stop = Temporal.PlainDate.from(normalizeDate(through, 'day'));
	const range = start.until(stop).days;
	if (range < 0 || range > 366) throw new RangeError('Invalid occurrence range');
	return { start, stop };
}

/** Return occurrences starting in an inclusive range of local calendar dates. */
export function expandOccasion(event: RecurringEvent, from: string, through: string) {
	const { start, stop } = validateOccurrenceRange(from, through);

	const local = originalLocalStart(event);
	const anchor = Temporal.PlainDate.from(local.slice(0, 10));
	const first = Temporal.PlainDate.compare(start, anchor) < 0 ? anchor : start;
	if (Temporal.PlainDate.compare(first, stop) > 0) return [];

	const { frequency, interval } = readRecurrence(event.recurrenceRule);
	// Advance to the first candidate period while preserving the original interval and day.
	const months = (first.year - anchor.year) * 12 + first.month - anchor.month;
	const days = anchor.until(first).days;
	const period = {
		YEARLY: first.year - anchor.year,
		MONTHLY: months,
		WEEKLY: Math.floor(days / 7),
		DAILY: days
	}[frequency];
	const offset = period - (period % interval);
	const seed =
		frequency === 'YEARLY'
			? anchor.with({ month: 1, day: 1 }).add({ years: offset })
			: frequency === 'MONTHLY'
				? anchor.with({ day: 1 }).add({ months: offset })
				: anchor.add({ days: frequency === 'WEEKLY' ? offset * 7 : offset });
	const leapDay = frequency === 'YEARLY' && anchor.month === 2 && anchor.day === 29;
	// The library uses Date.UTC, which treats years 0–99 as 1900–1999.
	// One Gregorian cycle preserves month lengths and weekdays.
	const shift = seed.year < 100 ? 400 : 0;
	const utcDate = (date: Temporal.PlainDate) => new Date(`${date.add({ years: shift })}T00:00:00Z`);
	const rule = new RRule({
		freq: RRule[frequency],
		interval,
		dtstart: utcDate(seed),
		bymonth: frequency === 'YEARLY' ? anchor.month : null,
		bymonthday: leapDay
			? [28, 29]
			: frequency === 'MONTHLY' || frequency === 'YEARLY'
				? anchor.day
				: null,
		bysetpos: leapDay ? -1 : null
	});

	const endDays = event.endDate ? anchor.until(event.endDate).days : 0;
	const duration =
		event.startsAt && event.endsAt ? event.endsAt.getTime() - event.startsAt.getTime() : null;
	return rule.between(utcDate(first), utcDate(stop), true).flatMap((day) => {
		const date = Temporal.PlainDate.from(day.toISOString().slice(0, 10))
			.subtract({ years: shift })
			.toString();
		let startsAt: Date | null = null;
		if (event.timeZone && event.startsAt) {
			try {
				// The original instant retains its selected fold. Future folds use the earlier instant.
				startsAt =
					date === anchor.toString()
						? event.startsAt
						: localToInstant(date + local.slice(10), event.timeZone, 'earlier');
			} catch (cause) {
				if (cause instanceof RangeError) return []; // Skip nonexistent local clock times.
				throw cause;
			}
		}
		return [
			{
				date,
				count: day.getUTCFullYear() - shift - anchor.year,
				value: {
					...event,
					startDate: startsAt ? null : date,
					endDate: event.endDate
						? Temporal.PlainDate.from(date).add({ days: endDays }).toString()
						: null,
					startsAt,
					endsAt: startsAt && duration !== null ? new Date(startsAt.getTime() + duration) : null
				}
			}
		];
	});
}
