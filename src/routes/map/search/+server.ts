import { error, json } from '@sveltejs/kit';
import { requireUser } from '#lib/server/auth/guard.ts';
import { parseForm } from '#lib/server/auth/schemas.ts';
import { placeSearch, searchPlaces } from '#lib/server/maps/gazetteer.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	requireUser(event);
	if (
		event.url.search ||
		!event.request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')
	)
		error(400, 'invalid');
	const parsed = parseForm(placeSearch, await event.request.formData());
	if (!parsed.success) error(400, 'invalid');
	return json(searchPlaces(parsed.data.q, event.locals.locale));
};
