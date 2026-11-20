import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { parseForm } from '#lib/server/auth/schemas.ts';
import { generateId } from '#lib/server/crypto/tokens.ts';
import { album, event } from '#lib/server/db/schema.ts';
import {
	albumTitle,
	listAlbums,
	listGroupedMemories,
	listMemories,
	pageField,
	queryFields,
	requireNoQuery
} from '#lib/server/media/gallery.ts';
import { mediaId } from '#lib/server/media/store.ts';
import type { Actions, PageServerLoad } from './$types';

const filters = z.strictObject({ event: mediaId.optional(), page: pageField });
export const load: PageServerLoad = (request) => {
	requireUser(request);
	const parsed = filters.safeParse(queryFields(request.request, request.url, ['/createAlbum']));
	if (!parsed.success) error(400, 'Invalid memory query');
	const sql = db();
	const eventId = parsed.data.event;
	const row = eventId
		? sql
				.select({ id: event.id, title: event.title })
				.from(event)
				.where(eq(event.id, eventId))
				.get()
		: null;
	if (eventId && !row) error(404, 'Event unavailable');
	if (row) {
		return { ...listMemories(sql, { eventId }, parsed.data.page), albums: [], event: row };
	}
	return { ...listGroupedMemories(sql, parsed.data.page), albums: listAlbums(sql), event: null };
};

export const actions: Actions = {
	createAlbum: async (request) => {
		const actor = requireUser(request);
		requireNoQuery(request, ['/createAlbum']);
		const parsed = parseForm(albumTitle, await request.request.formData());
		if (!parsed.success) return fail(400, { problem: 'invalid' });
		const id = generateId();
		db().insert(album).values({ id, title: parsed.data.title, createdBy: actor.id }).run();
		redirect(303, `/memories/albums/${id}`);
	}
};
