import { error } from '@sveltejs/kit';
import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import {
	calendarEntries,
	calendarQuery,
	calendarToday,
	calendarWindow
} from '#lib/server/events/calendar.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	requireUser(event);
	const query: Record<string, string> = Object.create(null);
	for (const [key, value] of event.url.searchParams) {
		if (Object.hasOwn(query, key)) error(400, 'invalid');
		query[key] = value;
	}
	const parsed = calendarQuery.safeParse(query);
	if (!parsed.success) error(400, 'invalid');

	const { locale } = event.locals;
	const { view } = parsed.data;
	const today = calendarToday(new Date());
	const date = parsed.data.date ?? today;
	const { days, first, last, previous, next, weekdays } = calendarWindow({ view, date }, locale);
	const entries = calendarEntries(db(), first, last, locale);
	return { view, today, date, days, first, last, previous, next, weekdays, entries };
};
