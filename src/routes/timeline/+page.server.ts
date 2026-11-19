import { error } from '@sveltejs/kit';
import { formatEventDate } from '#lib/domain/event-date.ts';
import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { listTimeline, timelineQuery } from '#lib/server/events/timeline.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	requireUser(event);
	const query: Record<string, string> = Object.create(null);
	for (const [key, value] of event.url.searchParams) {
		if (Object.hasOwn(query, key)) error(400, 'invalid');
		query[key] = value;
	}
	const parsed = timelineQuery.safeParse(query);
	if (!parsed.success) error(400, 'invalid');
	const { rows, ...pagination } = listTimeline(db(), parsed.data);
	const entries = rows.map((row) => ({
		id: row.id,
		year: row.sortDate.slice(0, 4),
		date: formatEventDate(event.locals.locale, row),
		kind: row.kind,
		category: row.category,
		title: row.title,
		place: row.place,
		preview: row.preview && {
			id: row.preview.id,
			label: row.preview.altText || row.preview.originalName
		}
	}));
	return {
		...pagination,
		years: Array.from(
			Map.groupBy(entries, (entry) => entry.year),
			([year, entries]) => ({
				year,
				entries
			})
		)
	};
};
