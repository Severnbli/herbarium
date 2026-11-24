import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '#lib/server/app.ts';
import { audit } from '#lib/server/audit.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { contentDeletion, parseForm } from '#lib/server/auth/schemas.ts';
import { album } from '#lib/server/db/schema.ts';
import { clientIp } from '#lib/server/http/request.ts';
import {
	albumTitle,
	findAlbum,
	listMemories,
	pageField,
	queryFields,
	requireNoQuery,
	routeMediaId
} from '#lib/server/media/gallery.ts';
import type { Actions, PageServerLoad } from './$types';

const filters = z.strictObject({ page: pageField });
export const load: PageServerLoad = (request) => {
	requireUser(request);
	const id = routeMediaId(request.params);
	const parsed = filters.safeParse(
		queryFields(request.request, request.url, ['/rename', '/delete'])
	);
	if (!parsed.success) error(400, 'Invalid album query');
	const sql = db();
	return { album: findAlbum(sql, id), ...listMemories(sql, { albumId: id }, parsed.data.page) };
};

export const actions: Actions = {
	rename: async (request) => {
		requireUser(request);
		requireNoQuery(request, ['/rename']);
		const id = routeMediaId(request.params);
		const parsed = parseForm(albumTitle, await request.request.formData());
		if (!parsed.success) return fail(400, { problem: 'invalid' as const });
		if (!db().update(album).set(parsed.data).where(eq(album.id, id)).run().changes)
			error(404, 'Album unavailable');
		redirect(303, `/memories/albums/${id}`);
	},
	delete: async (request) => {
		const actor = requireUser(request);
		requireNoQuery(request, ['/delete']);
		const id = routeMediaId(request.params);
		const parsed = parseForm(contentDeletion, await request.request.formData());
		if (!parsed.success) return fail(400, { deleteProblem: true });
		db().transaction((tx) => {
			if (!tx.delete(album).where(eq(album.id, id)).run().changes) error(404, 'Album unavailable');
			audit(tx, 'album_deleted', { actorId: actor.id, targetId: id, ip: clientIp(request) });
		});
		redirect(303, '/memories?view=albums');
	}
};
