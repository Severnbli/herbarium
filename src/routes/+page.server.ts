import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { loadDashboard } from '#lib/server/events/dashboard.ts';
import { getReminderPreferences } from '#lib/server/reminders/preferences.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	const user = requireUser(event);
	const sql = db();
	const { timeZone } = getReminderPreferences(sql, user.id);
	return {
		displayName: user.displayName,
		...loadDashboard(sql, event.locals.locale, timeZone, new Date())
	};
};
