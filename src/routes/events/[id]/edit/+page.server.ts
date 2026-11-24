import { fail, redirect } from '@sveltejs/kit';
import { listSavedPlaces } from '#lib/server/maps/places.ts';
import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { getConfig } from '#lib/server/config.ts';
import { hasBasemap } from '#lib/server/maps/assets.ts';
import {
	listEventPlaces,
	EventError,
	eventToForm,
	findEvent,
	updateEvent
} from '#lib/server/events/events.ts';
import { handleEventError, parseEventForm, routeEventId } from '#lib/server/events/forms.ts';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async (event) => {
	requireUser(event);
	const id = routeEventId(event.params);
	try {
		const row = findEvent(db(), id);
		return {
			planContext: row.kind === 'plan',
			id,
			places: listEventPlaces(db(), id).map((row) => ({
				place: row.place,
				savedPlaceId: row.savedPlaceId ?? '',
				lat: row.lat?.toString() ?? '',
				lon: row.lon?.toString() ?? ''
			})),
			values: eventToForm(row),
			savedPlaces: listSavedPlaces(db()),
			basemap: await hasBasemap(getConfig().dataDir)
		};
	} catch (cause) {
		handleEventError(cause);
	}
};
export const actions: Actions = {
	default: async (event) => {
		requireUser(event);
		const id = routeEventId(event.params);
		const parsed = parseEventForm(await event.request.formData());
		if (!parsed.ok)
			return fail(400, {
				problem: 'invalid' as const,
				fields: parsed.fields,
				places: parsed.places,
				values: parsed.values
			});
		try {
			updateEvent(db(), id, parsed.values, undefined, parsed.places);
		} catch (cause) {
			if (cause instanceof EventError && cause.code === 'not_finished')
				return fail(400, {
					problem: 'not_finished' as const,
					fields: ['kind'],
					places: parsed.places,
					values: parsed.values
				});
			handleEventError(cause);
		}
		redirect(303, `/events/${id}`);
	}
};
