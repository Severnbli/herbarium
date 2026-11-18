import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { formatEventDate, hasHappened } from '#lib/domain/event-date.ts';
import { db } from '#lib/server/app.ts';
import { audit } from '#lib/server/audit.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { confirmPassword } from '#lib/server/auth/login.ts';
import { currentPassword, parseForm } from '#lib/server/auth/schemas.ts';
import { EventError, completePlan, deleteEvent, findEvent } from '#lib/server/events/events.ts';
import { handleEventError, routeEventId } from '#lib/server/events/forms.ts';
import { describeOccasion } from '#lib/server/events/occasion-labels.ts';
import { renderNotes } from '#lib/server/events/notes.ts';
import { listMemories } from '#lib/server/media/gallery.ts';
import { clientIp, minutesUntil } from '#lib/server/http/request.ts';
import {
	getReminderOffsets,
	reminderOffsetsForm,
	saveReminderOffsets
} from '#lib/server/reminders/preferences.ts';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = (event) => {
	requireUser(event);
	const id = routeEventId(event.params);
	try {
		const row = findEvent(db(), id);
		return {
			event: row,
			reminderOffsets: getReminderOffsets(db(), id),
			memories: listMemories(db(), { eventId: id }),
			dateLabel: formatEventDate(event.locals.locale, row),
			notesHtml: renderNotes(row.notes),
			recurrence:
				row.recurrenceRule && row.occasionType
					? describeOccasion(event.locals.locale, {
							...row,
							recurrenceRule: row.recurrenceRule,
							occasionType: row.occasionType
						})
					: null,
			canComplete: row.kind === 'plan' && hasHappened(row)
		};
	} catch (cause) {
		handleEventError(cause);
	}
};
export const actions: Actions = {
	reminders: async (event) => {
		requireUser(event);
		const id = routeEventId(event.params);
		const parsed = parseForm(reminderOffsetsForm, await event.request.formData());
		if (!parsed.success) return fail(400, { reminderProblem: true });
		try {
			if (!saveReminderOffsets(db(), id, parsed.data)) return fail(400, { reminderProblem: true });
		} catch (cause) {
			handleEventError(cause);
		}
		redirect(303, `/events/${id}#event-reminders`);
	},
	complete: async (event) => {
		requireUser(event);
		const id = routeEventId(event.params);
		const parsed = parseForm(z.strictObject({}), await event.request.formData());
		if (!parsed.success) return fail(400, { problem: 'invalid' as const });
		try {
			completePlan(db(), id);
		} catch (cause) {
			if (cause instanceof EventError && cause.code === 'not_finished')
				return fail(400, { problem: 'not_finished' as const });
			handleEventError(cause);
		}
		redirect(303, `/events/${id}`);
	},
	delete: async (event) => {
		const actor = requireUser(event);
		const id = routeEventId(event.params);
		const parsed = parseForm(z.strictObject({ currentPassword }), await event.request.formData());
		if (!parsed.success) return fail(400, { problem: 'invalid' as const });
		const check = await confirmPassword(
			db(),
			actor.id,
			parsed.data.currentPassword,
			clientIp(event)
		);
		if (!check.ok)
			return check.reason === 'rate_limited'
				? fail(429, { problem: 'rate_limited' as const, minutes: minutesUntil(check.retryAfterMs) })
				: fail(400, { problem: 'wrong_password' as const });
		try {
			db().transaction((tx) => {
				deleteEvent(tx, id);
				audit(tx, 'event_deleted', { actorId: actor.id, targetId: id, ip: clientIp(event) });
			});
		} catch (cause) {
			handleEventError(cause);
		}
		redirect(303, '/events');
	}
};
