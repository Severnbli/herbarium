import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import type { Db } from '../db/index.ts';
import { event, memory } from '../db/schema.ts';
import { CATEGORIES } from './schemas.ts';

const PAGE_SIZE = 24;
const date = z.iso.date();
const cursor = z
	.string()
	.regex(/^(?!0000)\d{4}-\d{2}-\d{2}\.[A-Za-z0-9_-]{22}$/)
	.refine((value) => date.safeParse(value.slice(0, 10)).success);

export const timelineQuery = z
	.strictObject({
		kind: z.enum(['', 'moment', 'plan', 'occasion']).default(''),
		category: z.enum(['', ...CATEGORIES]).default(''),
		older: cursor.optional(),
		newer: cursor.optional()
	})
	.refine(({ older, newer }) => !(older && newer));

type Position = { sortDate: string; id: string };
const encode = ({ sortDate, id }: Position) => `${sortDate}.${id}`;

function boundary(direction: 'older' | 'newer', { sortDate, id }: Position) {
	const position = sql`(${event.sortDate}, ${event.id})`;
	const anchor = sql`(${sortDate}, ${id})`;
	return direction === 'older' ? sql`${position} < ${anchor}` : sql`${position} > ${anchor}`;
}

export function listTimeline(db: Db, query: z.input<typeof timelineQuery>) {
	const { kind, category, older, newer } = timelineQuery.parse(query);
	const from = newer ?? older;
	const direction = newer ? 'newer' : 'older';
	const order = newer ? asc : desc;
	const scope = and(
		kind ? eq(event.kind, kind) : undefined,
		category ? eq(event.category, category) : undefined
	);
	const attachment = alias(memory, 'attachment');
	const latestAttachment = db
		.select({ id: attachment.id })
		.from(attachment)
		.where(eq(attachment.eventId, event.id))
		.orderBy(desc(attachment.sortDate), desc(attachment.id))
		.limit(1);
	const rows = db
		.select({
			id: event.id,
			sortDate: event.sortDate,
			kind: event.kind,
			category: event.category,
			title: event.title,
			place: event.place,
			dateMode: event.dateMode,
			precision: event.precision,
			startDate: event.startDate,
			endDate: event.endDate,
			startsAt: event.startsAt,
			endsAt: event.endsAt,
			timeZone: event.timeZone,
			preview: { id: memory.id, altText: memory.altText, originalName: memory.originalName }
		})
		.from(event)
		.leftJoin(memory, eq(memory.id, latestAttachment))
		.where(
			and(
				scope,
				from ? boundary(direction, { sortDate: from.slice(0, 10), id: from.slice(11) }) : undefined
			)
		)
		.orderBy(order(event.sortDate), order(event.id))
		.limit(PAGE_SIZE + 1)
		.all();

	const more = rows.length > PAGE_SIZE;
	if (more) rows.pop();
	if (newer) rows.reverse();
	const first = rows[0];
	const last = rows.at(-1);
	const exists = (direction: 'older' | 'newer', position: Position) =>
		!!db
			.select({ id: event.id })
			.from(event)
			.where(and(scope, boundary(direction, position)))
			.limit(1)
			.get();

	return {
		rows,
		filters: { kind, category },
		newer: first && (newer ? more : older && exists('newer', first)) ? encode(first) : null,
		older: last && (newer ? exists('older', last) : more) ? encode(last) : null,
		fromCursor: !!from
	};
}
