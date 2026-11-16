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
