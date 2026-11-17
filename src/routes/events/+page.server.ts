import { error } from '@sveltejs/kit';
import { formatEventDate } from '#lib/domain/event-date.ts';
import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { listEvents } from '#lib/server/events/events.ts';
import { eventFilters } from '#lib/server/events/schemas.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	requireUser(event);
	const query: Record<string, string> = Object.create(null);
	for (const [key, value] of event.url.searchParams) {
		if (Object.hasOwn(query, key)) error(400, 'invalid');
		query[key] = value;
	}
	const parsed = eventFilters.safeParse(query);
	if (!parsed.success) error(400, 'invalid');
	const result = listEvents(db(), parsed.data);
	return {
		...result,
		rows: result.rows.map((row) => ({
			id: row.id,
			kind: row.kind,
			title: row.title,
			place: row.place,
			category: row.category,
			createdByName: row.createdByName,
			dateLabel: formatEventDate(event.locals.locale, row)
		}))
	};
};
