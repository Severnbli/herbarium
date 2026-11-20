import { error, fail, redirect } from '@sveltejs/kit';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, keys } from '#lib/server/app.ts';
import { audit } from '#lib/server/audit.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { parseForm } from '#lib/server/auth/schemas.ts';
import { getConfig } from '#lib/server/config.ts';
import { albumMemory, event, mediaFile, memory } from '#lib/server/db/schema.ts';
import { clientIp } from '#lib/server/http/request.ts';
import { acceptCoordinates } from '#lib/server/media/coordinates.ts';
import { confirmMediaDeletion } from '#lib/server/media/delete.ts';
import {
	findAlbum,
	findMemory,
	listAlbums,
	queryFields,
	requireNoQuery,
	routeMediaId
} from '#lib/server/media/gallery.ts';
import { mediaId, removeMediaFile } from '#lib/server/media/store.ts';
import { description } from '#lib/server/media/upload.ts';
import type { Actions, PageServerLoad } from './$types';

const eventSearch = z.strictObject({ q: z.string().trim().max(200).default('') });

export const load: PageServerLoad = (request) => {
	requireUser(request);
	const id = routeMediaId(request.params);
	const query = eventSearch.safeParse(
		queryFields(request.request, request.url, [
			'/description',
			'/album',
			'/coordinates',
			'/event',
			'/delete'
		])
	);
	if (!query.success) error(400, 'Invalid memory query');
	const database = db();
	const row = findMemory(database, id);
	const events = database
		.select({ id: event.id, title: event.title })
		.from(event)
		.where(
			and(
				row.eventId ? ne(event.id, row.eventId) : undefined,
				query.data.q ? sql`instr(lower(${event.title}), lower(${query.data.q})) > 0` : undefined
			)
		)
		.orderBy(desc(event.updatedAt), desc(event.id))
		.limit(30)
		.all();
	const selected = new Set(
		database
			.select({ id: albumMemory.albumId })
			.from(albumMemory)
			.where(eq(albumMemory.memoryId, id))
			.all()
			.map(({ id }) => id)
	);
	return {
		memory: row,
		events,
		search: query.data.q,
		albums: listAlbums(database).map((album) => ({
			...album,
			containsMemory: selected.has(album.id)
		}))
	};
};

export const actions: Actions = {
	event: async (request) => {
		requireUser(request);
		const id = routeMediaId(request.params);
		const query = eventSearch.safeParse(queryFields(request.request, request.url, ['/event']));
		if (!query.success) error(400, 'Invalid memory query');
		const parsed = parseForm(
			z.strictObject({ eventId: z.union([z.literal(''), mediaId]) }),
			await request.request.formData()
		);
		if (!parsed.success) return fail(400, { eventProblem: true });
		const eventId = parsed.data.eventId || null;
		const updated = db().transaction(
			(tx) => {
				findMemory(tx, id);
				if (eventId && !tx.select({ id: event.id }).from(event).where(eq(event.id, eventId)).get())
					return false;
				tx.update(memory).set({ eventId }).where(eq(memory.id, id)).run();
				return true;
			},
			{ behavior: 'immediate' }
		);
		if (!updated) return fail(400, { eventProblem: true });
		redirect(303, `/memories/${id}#linked-event`);
	},
	description: async (request) => {
		requireUser(request);
		requireNoQuery(request, ['/description']);
		const id = routeMediaId(request.params);
		const parsed = parseForm(z.strictObject(description), await request.request.formData());
		if (!parsed.success) return fail(400, { problem: 'invalid' as const });
		if (!db().update(memory).set(parsed.data).where(eq(memory.id, id)).run().changes)
			error(404, 'Memory unavailable');
		redirect(303, `/memories/${id}`);
	},
	album: async (request) => {
		requireUser(request);
		requireNoQuery(request, ['/album']);
		const id = routeMediaId(request.params);
		const parsed = parseForm(
			z.strictObject({ albumId: mediaId, operation: z.enum(['add', 'remove']) }),
			await request.request.formData()
		);
		if (!parsed.success) return fail(400, { problem: 'invalid' as const });
		const { albumId, operation } = parsed.data;
		db().transaction((tx) => {
			findMemory(tx, id);
			findAlbum(tx, albumId);
			if (operation === 'add')
				tx.insert(albumMemory).values({ albumId, memoryId: id }).onConflictDoNothing().run();
			else
				tx.delete(albumMemory)
					.where(and(eq(albumMemory.albumId, albumId), eq(albumMemory.memoryId, id)))
					.run();
		});
		redirect(303, `/memories/${id}`);
	},
	coordinates: async (request) => {
		requireUser(request);
		requireNoQuery(request, ['/coordinates']);
		const id = routeMediaId(request.params);
		const parsed = parseForm(
			z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/) }),
			await request.request.formData()
		);
		if (
			!parsed.success ||
			!acceptCoordinates(db(), keys().field, request.locals.session!.id, id, parsed.data.token)
		) {
			return fail(400, { problem: 'coordinates' as const });
		}
		const { eventId } = findMemory(db(), id);
		redirect(303, eventId ? `/events/${eventId}` : `/memories/${id}`);
	},
	delete: async (request) => {
		const actor = requireUser(request);
		requireNoQuery(request, ['/delete']);
		const id = routeMediaId(request.params);
		const failure = await confirmMediaDeletion(request, actor.id);
		if (failure) return failure;
		const files = db().transaction((tx) => {
			const assets = tx
				.select({ id: mediaFile.id })
				.from(mediaFile)
				.where(eq(mediaFile.memoryId, id))
				.all();
			if (!tx.delete(memory).where(eq(memory.id, id)).run().changes)
				error(404, 'Memory unavailable');
			audit(tx, 'memory_deleted', { actorId: actor.id, targetId: id, ip: clientIp(request) });
			return assets;
		});
		const results = await Promise.allSettled(
			files.map(({ id }) => removeMediaFile(getConfig().dataDir, id))
		);
		if (results.some(({ status }) => status === 'rejected'))
			console.error('Herbarium could not remove an unused encrypted media file.');
		redirect(303, '/memories');
	}
};
