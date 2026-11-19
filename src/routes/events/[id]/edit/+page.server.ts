import { fail, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { getConfig } from '#lib/server/config.ts';
import { hasBasemap } from '#lib/server/maps/assets.ts';
import { EventError, eventToForm, findEvent, updateEvent } from '#lib/server/events/events.ts';
import { handleEventError, parseEventForm, routeEventId } from '#lib/server/events/forms.ts';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async (event) => {
	requireUser(event);
	const id = routeEventId(event.params);
	try {
		return {
			id,
			values: eventToForm(findEvent(db(), id)),
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
				values: parsed.values
			});
		try {
			updateEvent(db(), id, parsed.values);
		} catch (cause) {
			if (cause instanceof EventError && cause.code === 'not_finished')
				return fail(400, {
					problem: 'not_finished' as const,
					fields: ['kind'],
					values: parsed.values
				});
			handleEventError(cause);
		}
		redirect(303, `/events/${id}`);
	}
};
