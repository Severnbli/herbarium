import { error } from '@sveltejs/kit';
import { formatEventDateLabel } from '#lib/i18n/format.ts';
import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { listPlans } from '#lib/server/events/events.ts';
import { planFilters } from '#lib/server/events/schemas.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	requireUser(event);
	const query: Record<string, string> = Object.create(null);
	for (const [key, value] of event.url.searchParams) {
		if (Object.hasOwn(query, key)) error(400, 'invalid');
		query[key] = value;
	}
	const parsed = planFilters.safeParse(query);
	if (!parsed.success) error(400, 'invalid');
	const result = listPlans(db(), parsed.data);
	return {
		filters: parsed.data,
		page: result.page,
		pages: result.pages,
		rows: result.rows.map((row) => ({
			id: row.id,
			title: row.title,
			place: row.place,
			undated: row.dateMode === 'undated',
			dateLabel: formatEventDateLabel(event.locals.locale, row)
		}))
	};
};
