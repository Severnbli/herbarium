import {
	and,
	asc,
	count,
	desc,
	eq,
	gte,
	isNotNull,
	isNull,
	lte,
	ne,
	not,
	sql,
	type SQL
} from 'drizzle-orm';
import {
	disambiguationFor,
	hasHappened,
	instantToLocal,
	localToInstant,
	normalizeDate
} from '#lib/domain/event-date.ts';
import { generateId } from '../crypto/tokens.ts';
import type { Db } from '../db/index.ts';
import { event, eventPlace, reminderDelivery, savedPlace, user } from '../db/schema.ts';
import {
	expandOccasion,
	readRecurrence,
	recurrenceRule,
	validateOccurrenceRange
} from './recurrence.ts';
import {
	eventFilters,
	eventFormSchema,
	eventId,
	eventPlaceFields,
	type EventForm,
	type EventPlaceForm
} from './schemas.ts';

export class EventError extends Error {
	constructor(public readonly code: 'not_found' | 'not_finished') {
		super(code);
		this.name = 'EventError';
	}
}
export type EventRecord = typeof event.$inferSelect;
export const PAGE_SIZE = 30;

type PlaceSnapshot = Pick<EventRecord, 'savedPlaceId' | 'lat' | 'lon'>;

function resolveEventPlace(db: Db, input: EventPlaceForm, previous: readonly PlaceSnapshot[]) {
	const snapshot = {
		place: input.place,
		lat: input.lat === '' ? null : Number(input.lat),
		lon: input.lon === '' ? null : Number(input.lon)
	};
	const saved = input.savedPlaceId
		? db.select().from(savedPlace).where(eq(savedPlace.id, input.savedPlaceId)).get()
		: undefined;
	if (!saved) return { ...snapshot, savedPlaceId: null };
	const keepCoordinates = previous.some(
		(stop) =>
			stop.savedPlaceId === saved.id && stop.lat === snapshot.lat && stop.lon === snapshot.lon
	);
	return {
		savedPlaceId: saved.id,
		place: saved.place,
		lat: keepCoordinates ? snapshot.lat : saved.lat,
		lon: keepCoordinates ? snapshot.lon : saved.lon
	};
}

/** Services accept validated inputs only; parsing here also protects non-route callers. */
function storage(db: Db, input: EventForm, previous?: EventRecord) {
	const value = eventFormSchema.parse(input);
	const timed = value.dateMode === 'timed';
	const undated = value.dateMode === 'undated';
	const startDate = value.dateMode === 'date' ? normalizeDate(value.start, value.precision) : null;
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
		...resolveEventPlace(db, value, previous ? [previous] : []),
		category: value.category,
		dateMode: value.dateMode,
		precision: undated ? ('day' as const) : value.precision,
		startDate,
		endDate:
			value.dateMode === 'date' && value.end ? normalizeDate(value.end, value.precision) : null,
		startsAt: timed ? localToInstant(value.start, value.timeZone, value.disambiguation) : null,
		endsAt:
			timed && value.end
				? localToInstant(value.end, value.timeZone, value.endDisambiguation)
				: null,
		timeZone: timed ? value.timeZone : null,
		sortDate: undated ? null : (startDate ?? value.start.slice(0, 10))
	};
}

function insertPlaces(
	db: Db,
	eventId: string,
	places: EventPlaceForm[],
	previous: readonly PlaceSnapshot[] = []
) {
	const locations = places
		.map((input) => resolveEventPlace(db, eventPlaceFields.parse(input), previous))
		.filter((stop) => stop.place || stop.lat !== null);
	for (const [position, stop] of locations.entries())
		db.insert(eventPlace)
			.values({ eventId, position, ...stop })
			.run();
}
export function listEventPlaces(db: Db, id: string) {
	return db
		.select()
		.from(eventPlace)
		.where(eq(eventPlace.eventId, id))
		.orderBy(eventPlace.position)
		.all();
}

export function createEvent(
	db: Db,
	actorId: string,
	input: EventForm,
	now = new Date(),
	places: EventPlaceForm[] = []
): string {
	const id = generateId();
	db.transaction((tx) => {
		const values = storage(tx, input);
		tx.insert(event)
			.values({ id, ...values, createdBy: actorId, createdAt: now, updatedAt: now })
			.run();
		insertPlaces(tx, id, places);
	});
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

export function updateEvent(
	db: Db,
	id: string,
	input: EventForm,
	now = new Date(),
	places?: EventPlaceForm[]
): void {
	db.transaction((tx) => {
		const previous = findEvent(tx, id);
		const values = storage(tx, input, previous);
		if (places) {
			const previousPlaces = listEventPlaces(tx, id);
			tx.delete(eventPlace).where(eq(eventPlace.eventId, id)).run();
			insertPlaces(tx, id, places, previousPlaces);
		}
		// Editing the kind must obey the same rule as the completion action.
		if (previous.kind === 'plan' && values.kind === 'moment' && !hasHappened(values, now))
			throw new EventError('not_finished');
		tx.update(event)
			.set({ ...values, updatedAt: now })
			.where(eq(event.id, id))
			.run();
		if (
			previous.dateMode !== values.dateMode ||
			previous.precision !== values.precision ||
			previous.sortDate !== values.sortDate ||
			previous.startsAt?.getTime() !== values.startsAt?.getTime() ||
			previous.timeZone !== values.timeZone ||
			previous.recurrenceRule !== values.recurrenceRule
		) {
			tx.delete(reminderDelivery)
				.where(and(eq(reminderDelivery.eventId, id), eq(reminderDelivery.status, 'pending')))
				.run();
		}
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

export function deleteEvent(db: Db, id: string): EventRecord['kind'] {
	return db.transaction((tx) => {
		const { kind } = findEvent(tx, id);
		tx.delete(event).where(eq(event.id, id)).run();
		return kind;
	});
}

function pageEvents(db: Db, where: SQL | undefined, order: SQL, requested: number) {
	const total = db.select({ n: count() }).from(event).where(where).get()!.n;
	const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const page = Math.min(requested, pages);
	const rows = db
		.select({ event, createdByName: user.displayName })
		.from(event)
		.innerJoin(user, eq(event.createdBy, user.id))
		.where(where)
		.orderBy(order, desc(event.id))
		.limit(PAGE_SIZE)
		.offset((page - 1) * PAGE_SIZE)
		.all();
	return {
		rows: rows.map((row) => ({ ...row.event, createdByName: row.createdByName })),
		total,
		page,
		pages
	};
}

function startYear(year: string) {
	return year
		? and(gte(event.sortDate, `${year}-01-01`), lte(event.sortDate, `${year}-12-31`))
		: undefined;
}

export function listEvents(
	db: Db,
	input: { kind?: string; year?: string; date?: string; page?: string },
	journal = false
) {
	const filters = eventFilters.parse(input);
	const where = and(
		journal ? ne(event.kind, 'plan') : undefined,
		filters.kind ? eq(event.kind, filters.kind) : undefined,
		filters.date === 'undated' ? isNull(event.sortDate) : undefined,
		startYear(filters.year)
	);
	const order = desc(filters.date === 'undated' ? event.createdAt : event.sortDate);
	return { ...pageEvents(db, where, order, Number(filters.page)), filters };
}

export function listPlans(
	db: Db,
	filters: { view: 'scheduled' | 'ideas' | 'review' | 'all'; year: string; page: string },
	now = new Date()
) {
	const today = now.toISOString().slice(0, 10);
	// Date-only ends are inclusive and stored at the start of their precision period.
	// The UTC boundaries match hasHappened, which also guards the completion action.
	const elapsed = sql`case when ${event.dateMode} = 'timed'
		then coalesce(${event.endsAt}, ${event.startsAt}) <= ${now.getTime()}
		else coalesce(${event.endDate}, ${event.startDate}) < case ${event.precision}
			when 'year' then ${today.slice(0, 4) + '-01-01'}
			when 'month' then ${today.slice(0, 7) + '-01'}
			else ${today}
		end
	end`;
	const stage = {
		scheduled: and(isNotNull(event.sortDate), not(elapsed)),
		ideas: isNull(event.sortDate),
		review: and(isNotNull(event.sortDate), elapsed),
		all: undefined
	}[filters.view];
	const order = {
		scheduled: asc(event.sortDate),
		ideas: desc(event.createdAt),
		review: desc(event.sortDate),
		all: desc(event.sortDate)
	}[filters.view];
	return pageEvents(
		db,
		and(eq(event.kind, 'plan'), stage, startYear(filters.year)),
		order,
		Number(filters.page)
	);
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
		savedPlaceId: value.savedPlaceId ?? '',
		lat: value.lat?.toString() ?? '',
		lon: value.lon?.toString() ?? '',
		category: value.category,
		dateMode: value.dateMode,
		precision: value.precision,
		start: timed
			? instantToLocal(value.startsAt!, value.timeZone!)
			: (value.startDate?.slice(0, length) ?? ''),
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
