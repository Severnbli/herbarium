import { and, desc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '#lib/server/db/index.ts';
import { event, memory } from '#lib/server/db/schema.ts';
import { latestEventAttachment } from '#lib/server/events/preview.ts';
import { CATEGORIES, eventFilters } from '#lib/server/events/schemas.ts';

export const mapFilters = z.strictObject({
	kind: eventFilters.shape.kind,
	year: eventFilters.shape.year,
	category: z.enum(['', ...CATEGORIES]).default('')
});

export function listPinnedEvents(db: Db, filters: z.infer<typeof mapFilters>) {
	const { kind, year, category } = filters;
	return db
		.select({
			id: event.id,
			kind: event.kind,
			title: event.title,
			place: event.place,
			lat: sql<number>`${event.lat}`,
			lon: sql<number>`${event.lon}`,
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
		.leftJoin(memory, eq(memory.id, latestEventAttachment(db)))
		.where(
			and(
				isNotNull(event.lat),
				isNotNull(event.lon),
				kind ? eq(event.kind, kind) : undefined,
				category ? eq(event.category, category) : undefined,
				year ? gte(event.sortDate, `${year}-01-01`) : undefined,
				year ? lte(event.sortDate, `${year}-12-31`) : undefined
			)
		)
		.orderBy(desc(event.sortDate), desc(event.id))
		.all();
}
