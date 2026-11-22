import { parseForm } from '#lib/server/auth/schemas.ts';
import { placeFields } from '#lib/server/events/schemas.ts';
import { savedPlace } from '#lib/server/db/schema.ts';
import { generateId } from '#lib/server/crypto/tokens.ts';
import { listSavedPlaces } from '#lib/server/maps/places.ts';
import { error, fail, redirect } from '@sveltejs/kit';
import { formatEventDateLabel } from '#lib/i18n/format.ts';
import type { MapEntry } from '#lib/maps/entry.ts';
import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { getConfig } from '#lib/server/config.ts';
import { hasBasemap } from '#lib/server/maps/assets.ts';
import { listPinnedEvents, mapFilters } from '#lib/server/maps/events.ts';
import type { Actions, PageServerLoad } from './$types';

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
		pinId: row.id + '/' + row.position,
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
	const savedPlaces = listSavedPlaces(db());
	return {
		entries,
		savedPlaces,
		filters: parsed.data,
		basemap: await hasBasemap(getConfig().dataDir)
	};
};

const savedFields = placeFields.refine((p) => Boolean(p.place && p.lat && p.lon));
export const actions: Actions = {
	save: async (event) => {
		const member = requireUser(event);
		const result = parseForm(savedFields, await event.request.formData());
		if (!result.success) return fail(400, { invalid: true });
		const { place, lat, lon } = result.data;
		db()
			.insert(savedPlace)
			.values({ id: generateId(), place, lat: Number(lat), lon: Number(lon), createdBy: member.id })
			.run();
		redirect(303, '/map#saved-places');
	}
};
