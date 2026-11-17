import { fail, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { createEvent } from '#lib/server/events/events.ts';
import { parseEventForm } from '#lib/server/events/forms.ts';
import { emptyEventForm } from '#lib/server/events/schemas.ts';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = (event) => {
	requireUser(event);
	return { values: { ...emptyEventForm } };
};
export const actions: Actions = {
	default: async (event) => {
		const actor = requireUser(event);
		const parsed = parseEventForm(await event.request.formData());
		if (!parsed.ok)
			return fail(400, {
				problem: 'invalid' as const,
				fields: parsed.fields,
				values: parsed.values
			});
		const id = createEvent(db(), actor.id, parsed.values);
		redirect(303, `/events/${id}`);
	}
};
