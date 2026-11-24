import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { audit } from '#lib/server/audit.ts';
import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { contentDeletion, formObject, parseForm } from '#lib/server/auth/schemas.ts';
import { generateId } from '#lib/server/crypto/tokens.ts';
import { savedPlace } from '#lib/server/db/schema.ts';
import { eventId, placeFields } from '#lib/server/events/schemas.ts';
import { getConfig } from '#lib/server/config.ts';
import { hasBasemap } from '#lib/server/maps/assets.ts';
import { updateSavedPlace } from '#lib/server/maps/places.ts';
import { clientIp } from '#lib/server/http/request.ts';
import type { Actions, PageServerLoad } from './$types';

function placeId(value: string) {
	if (!eventId.safeParse(value).success) error(404, 'not_found');
	return value;
}
const fields = placeFields.refine((p) => Boolean(p.place && p.lat && p.lon));
export const load: PageServerLoad = async (event) => {
	requireUser(event);
	const id = event.params.id;
	const place =
		id === 'new'
			? null
			: db()
					.select()
					.from(savedPlace)
					.where(eq(savedPlace.id, placeId(id)))
					.get();
	if (place === undefined) error(404, 'not_found');
	return {
		id,
		values: {
			place: place?.place ?? '',
			lat: place?.lat.toString() ?? '',
			lon: place?.lon.toString() ?? ''
		},
		basemap: await hasBasemap(getConfig().dataDir)
	};
};
export const actions: Actions = {
	save: async (event) => {
		const member = requireUser(event);
		const input = formObject(await event.request.formData());
		const parsed = fields.safeParse(input);
		if (!parsed.success)
			return fail(400, {
				invalid: true,
				values: {
					place: input?.place?.slice(0, 200) ?? '',
					lat: input?.lat?.slice(0, 32) ?? '',
					lon: input?.lon?.slice(0, 32) ?? ''
				}
			});
		const { place, lat, lon } = parsed.data;
		const values = { place, lat: Number(lat), lon: Number(lon) };
		if (event.params.id === 'new')
			db()
				.insert(savedPlace)
				.values({ ...values, id: generateId(), createdBy: member.id })
				.run();
		else if (!updateSavedPlace(db(), placeId(event.params.id), values)) error(404, 'not_found');
		redirect(303, '/map#saved-places');
	},
	remove: async (event) => {
		const member = requireUser(event);
		const id = placeId(event.params.id);
		const input = parseForm(contentDeletion, await event.request.formData());
		if (!input.success) return fail(400, { deleteProblem: true });
		db().transaction((tx) => {
			if (!tx.delete(savedPlace).where(eq(savedPlace.id, id)).run().changes)
				error(404, 'not_found');
			audit(tx, 'saved_place_deleted', { actorId: member.id, targetId: id, ip: clientIp(event) });
		});
		redirect(303, '/map#saved-places');
	}
};
