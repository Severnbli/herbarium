import type { Locale } from './index.ts';

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	['year', 365 * 24 * 3600],
	['month', 30 * 24 * 3600],
	['week', 7 * 24 * 3600],
	['day', 24 * 3600],
	['hour', 3600],
	['minute', 60]
];

/**
 * "3 hours ago", "in 6 days". Relative times read the same in every time zone, so server and
 * browser render identical text. `now` comes from the server to keep hydration consistent.
 */
export function formatRelative(locale: Locale, date: Date | number, now: Date | number): string {
	const seconds = (new Date(date).getTime() - new Date(now).getTime()) / 1000;
	const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
	for (const [unit, size] of UNITS) {
		if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
	}
	return format.format(0, 'minute');
}

/** Date-only values always format in UTC so the calendar day cannot shift. */
export function formatDateOnly(locale: Locale, date: string): string {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('Invalid calendar date');
	const instant = new Date(`${date}T00:00:00Z`);
	if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== date) {
		throw new RangeError('Invalid calendar date');
	}
	return new Intl.DateTimeFormat(locale, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC'
	}).format(instant);
}

/** Timed dates require the event's explicit IANA time zone, never the server's zone. */
export function formatDateTime(locale: Locale, date: Date | number, timeZone: string): string {
	return new Intl.DateTimeFormat(locale, {
		dateStyle: 'long',
		timeStyle: 'short',
		timeZone
	}).format(date);
}

/** CLDR week starts for the supported locales, numbered like Date.getDay(). */
export function weekStartsOn(locale: Locale): 0 | 1 {
	return ({ be: 1, ru: 1, en: 0 } as const)[locale];
}
