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
	listAlbumCovers,
	listGroupedMemories,
	listMemories,
	pageField,
	queryFields
} from '#lib/server/media/gallery.ts';
import { mediaId } from '#lib/server/media/store.ts';
import type { Actions, PageServerLoad } from './$types';

const albumView = z.strictObject({ view: z.literal('albums').optional() });
const filters = z.union([
	z.strictObject({ view: z.literal('albums') }),
	z.strictObject({ view: z.undefined().optional(), event: mediaId.optional(), page: pageField })
]);
export const load: PageServerLoad = (request) => {
	requireUser(request);
	const parsed = filters.safeParse(queryFields(request.request, request.url, ['/createAlbum']));
	if (!parsed.success) error(400, 'Invalid memory query');
	const sql = db();
	if (parsed.data.view === 'albums' || request.request.method === 'POST') {
		return { view: 'albums' as const, albums: listAlbumCovers(sql), event: null };
	}
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
		return {
			view: 'gallery' as const,
			...listMemories(sql, { eventId }, parsed.data.page),
			event: row
		};
	}
	return { view: 'gallery' as const, ...listGroupedMemories(sql, parsed.data.page), event: null };
};

export const actions: Actions = {
	createAlbum: async (request) => {
		const actor = requireUser(request);
		const query = albumView.safeParse(queryFields(request.request, request.url, ['/createAlbum']));
		if (!query.success) error(400, 'Invalid memory query');
		const parsed = parseForm(albumTitle, await request.request.formData());
		if (!parsed.success) return fail(400, { problem: 'invalid' });
		const id = generateId();
		db().insert(album).values({ id, title: parsed.data.title, createdBy: actor.id }).run();
		redirect(303, `/memories/albums/${id}`);
	}
};
