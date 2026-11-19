import { Temporal } from '@js-temporal/polyfill';
import { and, desc, eq, gte, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { formatEventDate, type EventDate } from '#lib/domain/event-date.ts';
import type { Locale } from '#lib/i18n/index.ts';
import type { Db } from '../db/index.ts';
import { event } from '../db/schema.ts';
import { listRecentMemories } from '../media/gallery.ts';
import { calendarToday, FIRST_DATE, LAST_DATE } from './calendar.ts';
import { occasionCountLabel } from './occasion-labels.ts';
import { expandOccasion, type RecurringEvent } from './recurrence.ts';

const fields = {
	id: event.id,
	title: event.title,
	sortDate: event.sortDate,
	dateMode: event.dateMode,
	precision: event.precision,
	startDate: event.startDate,
	endDate: event.endDate,
	startsAt: event.startsAt,
	endsAt: event.endsAt,
	timeZone: event.timeZone
};
const occasionFields = {
	...fields,
	recurrenceRule: event.recurrenceRule,
	occasionType: event.occasionType
};
type EventRow = Pick<typeof event.$inferSelect, keyof typeof fields>;
type OccasionRow = Pick<typeof event.$inferSelect, keyof typeof occasionFields>;

type Entry = {
	row: EventRow;
	value: EventDate;
	date: string;
	countLabel: string | null;
};

const dateWithinBounds = (date: Temporal.PlainDate) => {
	if (date.year < 1) return FIRST_DATE;
	return date.year > 9999 ? LAST_DATE : date.toString();
};

function occurrences(row: OccasionRow, from: string, through: string, locale: Locale) {
	if (!row.recurrenceRule) return [];
	const recurring: RecurringEvent = {
		...row,
		recurrenceRule: row.recurrenceRule,
		occasionType: row.occasionType ?? 'general'
	};
	return expandOccasion(recurring, from, through).map(({ value, date, count }) => ({
		row,
		value,
		date,
		countLabel: occasionCountLabel(locale, recurring.occasionType, count)
	}));
}

function compareStarts(a: Entry, b: Entry) {
	return (
		a.date.localeCompare(b.date) ||
		Number(b.value.precision === 'day') - Number(a.value.precision === 'day') ||
		(a.value.startsAt?.getTime() ?? -Infinity) - (b.value.startsAt?.getTime() ?? -Infinity) ||
		a.row.id.localeCompare(b.row.id)
	);
}

function nextAnniversaryOccurrence(row: OccasionRow, locale: Locale, now: Date, today: string) {
	const localToday = row.timeZone ? calendarToday(now, row.timeZone) : today;
	let from = row.sortDate > localToday ? row.sortDate : localToday;
	while (true) {
		const end = dateWithinBounds(Temporal.PlainDate.from(from).add({ years: 1 }));
		const next = occurrences(row, from, end, locale).find(({ value }) =>
			value.startsAt ? value.startsAt >= now : true
		);
		// A nonexistent local time can skip the next scheduled anniversary.
		if (next || end === LAST_DATE) return next;
		from = Temporal.PlainDate.from(end).add({ days: 1 }).toString();
	}
}

export function loadDashboard(db: Db, locale: Locale, timeZone: string, now: Date) {
	const today = calendarToday(now, timeZone);
	const day = Temporal.PlainDate.from(today);
	const through = dateWithinBounds(day.add({ days: 29 }));
	// At the same instant, saved and member time zones can be two local dates apart.
	const firstLocal = dateWithinBounds(day.subtract({ days: 2 }));
	const lastLocal = dateWithinBounds(Temporal.PlainDate.from(through).add({ days: 2 }));
	const memberDate = (entry: Entry) =>
		entry.value.startsAt ? calendarToday(entry.value.startsAt, timeZone) : entry.date;
	const isUpcoming = (entry: Entry) =>
		entry.value.startsAt ? entry.value.startsAt >= now : entry.date >= today;
	const toCard = ({ row, value, countLabel, date }: Entry) => ({
		id: row.id,
		title: row.title,
		label: formatEventDate(locale, value.startsAt ? { ...value, timeZone } : value),
		countLabel,
		days: value.precision === 'day' ? day.until(date).days : null
	});

	const singleEvents = db
		.select(fields)
		.from(event)
		.where(
			and(
				lte(event.sortDate, lastLocal),
				or(ne(event.kind, 'occasion'), isNull(event.recurrenceRule)),
				or(
					and(eq(event.precision, 'day'), gte(event.sortDate, firstLocal)),
					and(eq(event.precision, 'month'), gte(event.sortDate, day.with({ day: 1 }).toString())),
					and(
						eq(event.precision, 'year'),
						gte(event.sortDate, day.with({ month: 1, day: 1 }).toString())
					)
				)
			)
		)
		.all();
	const occasions = db
		.select(occasionFields)
		.from(event)
		.where(
			and(
				eq(event.kind, 'occasion'),
				or(lte(event.sortDate, lastLocal), eq(event.occasionType, 'anniversary'))
			)
		)
		.all();
	const upcoming = [
		...singleEvents
			.map((row): Entry => ({ row, value: row, date: row.sortDate, countLabel: null }))
			.filter((entry) => entry.value.precision !== 'day' || isUpcoming(entry)),
		...occasions.flatMap((row) => {
			if (row.sortDate > lastLocal) return [];
			const next = occurrences(row, firstLocal, lastLocal, locale).find(isUpcoming);
			return next ? [next] : [];
		})
	]
		.map((entry) => ({
			...entry,
			date: entry.value.precision !== 'day' && entry.date < today ? today : memberDate(entry)
		}))
		.filter(({ date }) => date <= through)
		.sort(compareStarts)
		.slice(0, 6)
		.map(toCard);

	const anniversaries = occasions.filter(
		(row) => row.occasionType === 'anniversary' && row.recurrenceRule
	);
	const nextAnniversary = anniversaries
		.flatMap((row) => {
			const next = nextAnniversaryOccurrence(row, locale, now, today);
			return next ? [{ ...next, date: memberDate(next) }] : [];
		})
		.sort(compareStarts)[0];
	const since = anniversaries
		.filter((row) => (row.startsAt ? row.startsAt <= now : row.sortDate <= today))
		.map((row) => (row.startsAt ? calendarToday(row.startsAt, timeZone) : row.sortDate))
		.sort()[0];

	const onThisDay = db
		.select(fields)
		.from(event)
		.where(
			and(
				lt(event.sortDate, day.with({ month: 1, day: 1 }).toString()),
				ne(event.kind, 'plan'),
				eq(event.precision, 'day'),
				sql`substr(${event.sortDate}, 6) = ${today.slice(5)}`
			)
		)
		.orderBy(desc(event.sortDate), desc(event.id))
		.limit(5)
		.all()
		.map((row) => ({ id: row.id, title: row.title, label: formatEventDate(locale, row) }));

	return {
		today,
		upcoming,
		nextAnniversary: nextAnniversary ? toCard(nextAnniversary) : null,
		together: since ? { since, days: day.since(since).days } : null,
		onThisDay,
		memories: listRecentMemories(db)
	};
}
