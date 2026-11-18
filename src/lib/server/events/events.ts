import { and, count, desc, eq, gte, lte } from 'drizzle-orm';
import {
	disambiguationFor,
	hasHappened,
	instantToLocal,
	localToInstant,
	normalizeDate
} from '#lib/domain/event-date.ts';
import { generateId } from '../crypto/tokens.ts';
import type { Db } from '../db/index.ts';
import { event, user } from '../db/schema.ts';
import {
	expandOccasion,
	readRecurrence,
	recurrenceRule,
	validateOccurrenceRange
} from './recurrence.ts';
import { eventFilters, eventFormSchema, eventId, type EventForm } from './schemas.ts';

export class EventError extends Error {
	constructor(public readonly code: 'not_found' | 'not_finished') {
		super(code);
		this.name = 'EventError';
	}
}
export type EventRecord = typeof event.$inferSelect;
export const PAGE_SIZE = 30;

/** Services accept validated inputs only; parsing here also protects non-route callers. */
function storage(input: EventForm) {
	const value = eventFormSchema.parse(input);
	const timed = value.dateMode === 'timed';
	const startDate = timed ? null : normalizeDate(value.start, value.precision);
	return {
		kind: value.kind,
		recurrenceRule:
			value.kind === 'occasion'
				? recurrenceRule(
						value.repeat === 'custom'
							? value.frequency
							: value.repeat === 'yearly'
								? 'YEARLY'
								: 'MONTHLY',
						value.repeat === 'custom' ? Number(value.interval) : 1
					)
				: null,
		occasionType: value.kind === 'occasion' ? value.occasionType : null,
		title: value.title,
		notes: value.notes,
		place: value.place,
		category: value.category,
		lat: value.lat === '' ? null : Number(value.lat),
		lon: value.lon === '' ? null : Number(value.lon),
		dateMode: value.dateMode,
		precision: value.precision,
		startDate,
		endDate: !timed && value.end ? normalizeDate(value.end, value.precision) : null,
		startsAt: timed ? localToInstant(value.start, value.timeZone, value.disambiguation) : null,
		endsAt:
			timed && value.end
				? localToInstant(value.end, value.timeZone, value.endDisambiguation)
				: null,
		timeZone: timed ? value.timeZone : null,
		sortDate: startDate ?? value.start.slice(0, 10)
	};
}

export function createEvent(db: Db, actorId: string, input: EventForm, now = new Date()): string {
	const values = storage(input);
	const id = generateId();
	db.insert(event)
		.values({ id, ...values, createdBy: actorId, createdAt: now, updatedAt: now })
		.run();
	return id;
}

export function findEvent(db: Db, id: string) {
	eventId.parse(id);
	const row = db
		.select({ event, createdByName: user.displayName })
		.from(event)
		.innerJoin(user, eq(event.createdBy, user.id))
		.where(eq(event.id, id))
		.get();
	if (!row) throw new EventError('not_found');
	return { ...row.event, createdByName: row.createdByName };
}

export function updateEvent(db: Db, id: string, input: EventForm, now = new Date()): void {
	const values = storage(input);
	db.transaction((tx) => {
		const previous = findEvent(tx, id);
		// Editing the kind must obey the same rule as the completion action.
		if (previous.kind === 'plan' && values.kind === 'moment' && !hasHappened(values, now))
			throw new EventError('not_finished');
		tx.update(event)
			.set({ ...values, updatedAt: now })
			.where(eq(event.id, id))
			.run();
	});
}

/** One row changes kind; identity, author and original creation time remain intact. */
export function completePlan(db: Db, id: string, now = new Date()): void {
	db.transaction((tx) => {
		const current = findEvent(tx, id);
		if (current.kind !== 'plan' || !hasHappened(current, now)) throw new EventError('not_finished');
		tx.update(event)
			.set({ kind: 'moment', updatedAt: now })
			.where(and(eq(event.id, id), eq(event.kind, 'plan')))
			.run();
	});
}

/** The route must confirm the acting member's password before calling this. */
export function deleteEvent(db: Db, id: string): void {
	db.transaction((tx) => {
		findEvent(tx, id);
		tx.delete(event).where(eq(event.id, id)).run();
	});
}

export function listEvents(db: Db, input: { kind?: string; year?: string; page?: string }) {
	const filters = eventFilters.parse(input);
	const where = and(
		filters.kind ? eq(event.kind, filters.kind) : undefined,
		filters.year ? gte(event.sortDate, `${filters.year}-01-01`) : undefined,
		filters.year ? lte(event.sortDate, `${filters.year}-12-31`) : undefined
	);
	const total = db.select({ n: count() }).from(event).where(where).get()!.n;
	const page = Math.min(Number(filters.page), Math.max(1, Math.ceil(total / PAGE_SIZE)));
	const rows = db
		.select({ event, createdByName: user.displayName })
		.from(event)
		.innerJoin(user, eq(event.createdBy, user.id))
		.where(where)
		.orderBy(desc(event.sortDate), desc(event.id))
		.limit(PAGE_SIZE)
		.offset((page - 1) * PAGE_SIZE)
		.all();
	return {
		rows: rows.map((row) => ({ ...row.event, createdByName: row.createdByName })),
		total,
		page,
		pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
		filters
	};
}

export function listOccurrences(db: Db, from: string, through: string) {
	validateOccurrenceRange(from, through);
	const rows = db
		.select()
		.from(event)
		.where(and(eq(event.kind, 'occasion'), lte(event.sortDate, through)))
		.all();
	return rows
		.flatMap((row) =>
			row.recurrenceRule
				? expandOccasion(
						{
							...row,
							recurrenceRule: row.recurrenceRule,
							occasionType: row.occasionType ?? 'general'
						},
						from,
						through
					).map((occurrence) => ({ ...occurrence, eventId: row.id }))
				: []
		)
		.sort((a, b) => a.date.localeCompare(b.date) || a.eventId.localeCompare(b.eventId));
}

export function eventToForm(value: EventRecord): EventForm {
	const timed = value.dateMode === 'timed';
	const rule = value.recurrenceRule ? readRecurrence(value.recurrenceRule) : null;
	const length = { day: 10, month: 7, year: 4 }[value.precision];
	return {
		kind: value.kind,
		repeat:
			rule?.interval === 1 && rule.frequency === 'YEARLY'
				? 'yearly'
				: rule?.interval === 1 && rule.frequency === 'MONTHLY'
					? 'monthly'
					: rule
						? 'custom'
						: 'yearly',
		frequency: rule?.frequency ?? 'WEEKLY',
		interval: String(rule?.interval ?? 1),
		occasionType: value.occasionType ?? 'general',
		title: value.title,
		notes: value.notes,
		place: value.place,
		lat: value.lat?.toString() ?? '',
		lon: value.lon?.toString() ?? '',
		category: value.category,
		dateMode: value.dateMode,
		precision: value.precision,
		start: timed
			? instantToLocal(value.startsAt!, value.timeZone!)
			: value.startDate!.slice(0, length),
		end: timed
			? value.endsAt
				? instantToLocal(value.endsAt, value.timeZone!)
				: ''
			: (value.endDate?.slice(0, length) ?? ''),
		timeZone: value.timeZone ?? 'Europe/Minsk',
		disambiguation: timed ? disambiguationFor(value.startsAt!, value.timeZone!) : 'reject',
		endDisambiguation:
			timed && value.endsAt ? disambiguationFor(value.endsAt, value.timeZone!) : 'reject'
	};
}
