import { Temporal } from '@js-temporal/polyfill';
import { and, eq, gte, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import {
	formatEventDate,
	instantToLocal,
	normalizeDate,
	type EventDate
} from '#lib/domain/event-date.ts';
import { weekStartsOn } from '#lib/i18n/format.ts';
import type { Locale } from '#lib/i18n/index.ts';
import type { Db } from '../db/index.ts';
import { event } from '../db/schema.ts';
import { occasionCountLabel } from './occasion-labels.ts';
import { expandOccasion } from './recurrence.ts';

export const CALENDAR_VIEWS = ['month', 'week', 'day'] as const;
export const DEFAULT_CALENDAR_ZONE = 'Europe/Minsk';
export const FIRST_DATE = '0001-01-01';
export const LAST_DATE = '9999-12-31';

export const calendarDate = z
	.string()
	.length(10)
	.refine((date) => {
		try {
			return normalizeDate(date, 'day') === date;
		} catch {
			return false;
		}
	});

export const calendarQuery = z.strictObject({
	view: z.enum(CALENDAR_VIEWS).default('month'),
	date: calendarDate.optional()
});

export function calendarToday(now: Date, timeZone = DEFAULT_CALENDAR_ZONE) {
	return instantToLocal(now, timeZone).slice(0, 10);
}

const supportedDate = (date: Temporal.PlainDate) =>
	date.year >= 1 && date.year <= 9999 ? date.toString() : null;

export function calendarWindow(
	{ view, date }: { view: (typeof CALENDAR_VIEWS)[number]; date: string },
	locale: Locale
) {
	const focus = Temporal.PlainDate.from(date);
	const weekStart = weekStartsOn(locale);
	const startOfWeek = (day: Temporal.PlainDate) =>
		day.subtract({ days: (day.dayOfWeek + 7 - weekStart) % 7 });

	const month = focus.with({ day: 1 });
	const start =
		view === 'month' ? startOfWeek(month) : view === 'week' ? startOfWeek(focus) : focus;
	const end =
		view === 'month'
			? startOfWeek(month.with({ day: month.daysInMonth })).add({ days: 6 })
			: view === 'week'
				? start.add({ days: 6 })
				: start;
	const offset = view === 'month' ? { months: 1 } : { days: view === 'week' ? 7 : 1 };
	const days = Array.from({ length: start.until(end).days + 1 }, (_, i) =>
		supportedDate(start.add({ days: i }))
	);
	return {
		days,
		first: supportedDate(start) ?? FIRST_DATE,
		last: supportedDate(end) ?? LAST_DATE,
		previous:
			Temporal.PlainDate.compare(view === 'month' ? month : start, FIRST_DATE) > 0
				? (supportedDate(focus.subtract(offset)) ?? FIRST_DATE)
				: null,
		next:
			Temporal.PlainDate.compare(
				view === 'month' ? month.with({ day: month.daysInMonth }) : end,
				LAST_DATE
			) < 0
				? (supportedDate(focus.add(offset)) ?? LAST_DATE)
				: null,
		weekdays:
			view === 'day'
				? []
				: Array.from({ length: 7 }, (_, index) =>
						new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
							new Date(Date.UTC(2024, 0, 7 + weekStart + index))
						)
					)
	};
}

/** Timed ends are exclusive and keep their event's zone. An approximate date keeps its precision label. */
function lastCalendarDate(value: EventDate, start: string) {
	if (value.endDate) return value.endDate.startsWith('+') ? LAST_DATE : value.endDate;
	if (value.endsAt) {
		const localEnd = instantToLocal(new Date(value.endsAt.getTime() - 1), value.timeZone!);
		if (localEnd.startsWith('+')) return LAST_DATE;
		const date = localEnd.slice(0, 10);
		return date < start ? start : date;
	}
	return start;
}

const asUtc = (date: string) => new Date(`${date}T00:00:00Z`);

export function calendarEntries(db: Db, first: string, last: string, locale: Locale) {
	const rows = db
		.select({
			id: event.id,
			title: event.title,
			kind: event.kind,
			sortDate: event.sortDate,
			dateMode: event.dateMode,
			precision: event.precision,
			startDate: event.startDate,
			endDate: event.endDate,
			startsAt: event.startsAt,
			endsAt: event.endsAt,
			timeZone: event.timeZone,
			recurrenceRule: event.recurrenceRule,
			occasionType: event.occasionType
		})
		.from(event)
		.where(
			and(
				lte(event.sortDate, last),
				or(
					eq(event.kind, 'occasion'),
					gte(event.sortDate, first),
					gte(event.endDate, first),
					// A local date can differ from UTC. Check the exact end in the event zone below.
					gte(event.endsAt, new Date(asUtc(first).getTime() - 2 * 86_400_000))
				)
			)
		)
		.all();

	const entries = rows.flatMap((row) => {
		const entry = (date: string, value: EventDate, count?: number) => ({
			id: row.id,
			title: row.title,
			kind: row.kind,
			precision: row.precision,
			date,
			end: lastCalendarDate(value, date),
			label: value.precision !== 'day' ? formatEventDate(locale, value) : null,
			occasionCount:
				count === undefined
					? null
					: occasionCountLabel(locale, row.occasionType ?? 'general', count),
			time: value.startsAt
				? new Intl.DateTimeFormat(locale, {
						timeStyle: 'short',
						timeZone: value.timeZone!
					}).format(value.startsAt)
				: null,
			instant: value.startsAt?.getTime() ?? null
		});
		if (row.kind !== 'occasion' || !row.recurrenceRule) {
			const result = entry(row.sortDate, row);
			return result.end >= first ? [result] : [];
		}
		const recurring = {
			...row,
			recurrenceRule: row.recurrenceRule,
			occasionType: row.occasionType ?? ('general' as const)
		};
		const occurrences = expandOccasion(recurring, first, last);
		// Show the latest ongoing occurrence from before the grid. Occurrences starting in the
		// grid remain separate, including when their spans overlap.
		const duration = row.endDate
			? Temporal.PlainDate.from(row.sortDate).until(row.endDate).days
			: row.endsAt && row.startsAt
				? Math.ceil((row.endsAt.getTime() - row.startsAt.getTime()) / 86_400_000) + 2
				: 0;
		let through = Temporal.PlainDate.from(first).subtract({ days: 1 });
		const earliest = Temporal.PlainDate.from(first).subtract({ days: duration });
		const lower =
			Temporal.PlainDate.compare(earliest, row.sortDate) < 0
				? Temporal.PlainDate.from(row.sortDate)
				: earliest;
		while (Temporal.PlainDate.compare(through, lower) >= 0) {
			const chunk = through.subtract({ days: 366 });
			const from = Temporal.PlainDate.compare(chunk, lower) < 0 ? lower : chunk;
			const previous = expandOccasion(recurring, from.toString(), through.toString()).at(-1);
			if (previous) {
				if (lastCalendarDate(previous.value, previous.date) >= first) occurrences.unshift(previous);
				break;
			}
			through = from.subtract({ days: 1 });
		}
		return occurrences.map(({ date, value, count }) => entry(date, value, count));
	});
	return entries.sort(
		(a, b) =>
			a.date.localeCompare(b.date) ||
			(a.instant ?? -Infinity) - (b.instant ?? -Infinity) ||
			a.title.localeCompare(b.title, locale) ||
			a.id.localeCompare(b.id)
	);
}
