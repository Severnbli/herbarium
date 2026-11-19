import { Temporal } from '@js-temporal/polyfill';
import type { Locale } from '#lib/i18n/index.ts';

export const PRECISIONS = ['day', 'month', 'year'] as const;
export type Precision = (typeof PRECISIONS)[number];
export const DISAMBIGUATIONS = ['reject', 'earlier', 'later'] as const;
export type Disambiguation = (typeof DISAMBIGUATIONS)[number];

export interface EventDate {
	dateMode: 'date' | 'timed';
	precision: Precision;
	startDate: string | null;
	endDate: string | null;
	startsAt: Date | null;
	endsAt: Date | null;
	timeZone: string | null;
}

/** Approximate dates use the first day of their period, never a UTC timestamp. */
export function normalizeDate(value: string, precision: Precision): string {
	const patterns = { day: /^\d{4}-\d{2}-\d{2}$/, month: /^\d{4}-\d{2}$/, year: /^\d{4}$/ };
	if (!patterns[precision].test(value) || value.startsWith('0000'))
		throw new RangeError('Invalid date');
	const full = value + { day: '', month: '-01', year: '-01-01' }[precision];
	return Temporal.PlainDate.from(full, { overflow: 'reject' }).toString();
}

export function validTimeZone(value: string): boolean {
	// Reject fixed numeric offsets: events retain geographic DST rules.
	if (!value || /^[+-]/.test(value) || value.length > 100) return false;
	try {
		new Intl.DateTimeFormat('en', { timeZone: value });
		return true;
	} catch {
		return false;
	}
}

/** Gaps are always rejected. Repeated local times require an explicit earlier/later choice. */
export function localToInstant(
	value: string,
	timeZone: string,
	disambiguation: Disambiguation = 'reject'
): Date {
	if (
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ||
		value.startsWith('0000') ||
		!validTimeZone(timeZone)
	)
		throw new RangeError('Invalid local time');
	const local = Temporal.PlainDateTime.from(value, { overflow: 'reject' });
	const zoned = local.toZonedDateTime(timeZone, { disambiguation });
	if (!zoned.toPlainDateTime().equals(local)) throw new RangeError('Nonexistent local time');
	return new Date(zoned.epochMilliseconds);
}

export function instantToLocal(value: Date, timeZone: string): string {
	return Temporal.Instant.fromEpochMilliseconds(value.getTime())
		.toZonedDateTimeISO(timeZone)
		.toPlainDateTime()
		.toString({ smallestUnit: 'minute' });
}

/** Choose the fold that round-trips the stored instant when an event is edited. */
export function disambiguationFor(value: Date, timeZone: string): Disambiguation {
	const local = instantToLocal(value, timeZone);
	try {
		localToInstant(local, timeZone);
		return 'reject';
	} catch {
		return localToInstant(local, timeZone, 'earlier').getTime() === value.getTime()
			? 'earlier'
			: 'later';
	}
}

export function formatEventDate(locale: Locale, value: EventDate): string {
	const format = (date: string | Date) =>
		new Intl.DateTimeFormat(
			locale,
			value.dateMode === 'timed'
				? { dateStyle: 'long', timeStyle: 'short', timeZone: value.timeZone! }
				: {
						year: 'numeric',
						...(value.precision !== 'year' ? { month: 'long' as const } : {}),
						...(value.precision === 'day' ? { day: 'numeric' as const } : {}),
						timeZone: 'UTC'
					}
		).format(typeof date === 'string' ? new Date(`${date}T00:00:00Z`) : date);
	const start = value.dateMode === 'timed' ? value.startsAt! : value.startDate!;
	const end = value.dateMode === 'timed' ? value.endsAt : value.endDate;
	return end ? `${format(start)} – ${format(end)}` : format(start);
}

/** Date-only periods finish at the next UTC day/month/year boundary. End dates are inclusive. */
export function hasHappened(value: EventDate, now = new Date()): boolean {
	if (value.dateMode === 'timed')
		return (value.endsAt ?? value.startsAt)!.getTime() <= now.getTime();
	const last = Temporal.PlainDate.from((value.endDate ?? value.startDate)!);
	const next = last.add(
		value.precision === 'year'
			? { years: 1 }
			: value.precision === 'month'
				? { months: 1 }
				: { days: 1 }
	);
	return Temporal.PlainDate.compare(next, now.toISOString().slice(0, 10)) <= 0;
}
