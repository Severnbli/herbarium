import { error } from '@sveltejs/kit';
import { formatEventDateLabel } from '#lib/i18n/format.ts';
import type { MapEntry } from '#lib/maps/entry.ts';
import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { getConfig } from '#lib/server/config.ts';
import { hasBasemap } from '#lib/server/maps/assets.ts';
import { listPinnedEvents, mapFilters } from '#lib/server/maps/events.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	requireUser(event);
	const query: Record<string, string> = Object.create(null);
	for (const [key, value] of event.url.searchParams) {
		if (Object.hasOwn(query, key)) error(400, 'invalid');
		query[key] = value;
	}
	const parsed = mapFilters.safeParse(query);
	if (!parsed.success) error(400, 'invalid');

	const entries: MapEntry[] = listPinnedEvents(db(), parsed.data).map((row) => ({
		id: row.id,
		kind: row.kind,
		title: row.title,
		date: formatEventDateLabel(event.locals.locale, row),
		place: row.place,
		lat: row.lat,
		lon: row.lon,
		preview: row.preview && {
			id: row.preview.id,
			label: row.preview.altText || row.preview.originalName
		}
	}));
	return { entries, filters: parsed.data, basemap: await hasBasemap(getConfig().dataDir) };
};
