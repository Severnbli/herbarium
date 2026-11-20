import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { getConfig } from '#lib/server/config.ts';
import { hasBasemap } from '#lib/server/maps/assets.ts';
import { calendarDate, calendarToday } from '#lib/server/events/calendar.ts';
import { createEvent } from '#lib/server/events/events.ts';
import { parseEventForm } from '#lib/server/events/forms.ts';
import { emptyEventForm, type EventForm } from '#lib/server/events/schemas.ts';
import { getReminderPreferences } from '#lib/server/reminders/preferences.ts';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async (event) => {
	const member = requireUser(event);
	const query = [...event.url.searchParams];
	if (query.length === 0)
		return {
			values: { ...emptyEventForm },
			calendarDate: null,
			basemap: await hasBasemap(getConfig().dataDir)
		};
	const [key, value] = query[0]!;
	if (query.length === 1 && key === 'kind' && value === 'plan')
		return {
			values: { ...emptyEventForm, kind: 'plan', dateMode: 'undated' } satisfies EventForm,
			calendarDate: null,
			basemap: await hasBasemap(getConfig().dataDir)
		};
	const date = calendarDate.safeParse(value);
	if (query.length !== 1 || key !== 'date' || !date.success) error(400, 'invalid');
	const { timeZone } = getReminderPreferences(db(), member.id);
	const kind: EventForm['kind'] =
		date.data < calendarToday(new Date(), timeZone) ? 'moment' : 'plan';
	return {
		values: { ...emptyEventForm, kind, start: date.data, timeZone },
		calendarDate: date.data,
		basemap: await hasBasemap(getConfig().dataDir)
	};
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
