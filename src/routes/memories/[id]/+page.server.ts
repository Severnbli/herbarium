import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, keys } from '#lib/server/app.ts';
import { audit } from '#lib/server/audit.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { parseForm } from '#lib/server/auth/schemas.ts';
import { getConfig } from '#lib/server/config.ts';
import { albumMemory, mediaFile, memory } from '#lib/server/db/schema.ts';
import { clientIp } from '#lib/server/http/request.ts';
import { acceptCoordinates } from '#lib/server/media/coordinates.ts';
import { confirmMediaDeletion } from '#lib/server/media/delete.ts';
import {
	findAlbum,
	findMemory,
	listAlbums,
	requireNoQuery,
	routeMediaId
} from '#lib/server/media/gallery.ts';
import { mediaId, removeMediaFile } from '#lib/server/media/store.ts';
import { description } from '#lib/server/media/upload.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (request) => {
	requireUser(request);
	const id = routeMediaId(request.params);
	requireNoQuery(request, ['/description', '/album', '/coordinates', '/delete']);
	const sql = db();
	const row = findMemory(sql, id);
	const selected = new Set(
		sql
			.select({ id: albumMemory.albumId })
			.from(albumMemory)
			.where(eq(albumMemory.memoryId, id))
			.all()
			.map(({ id }) => id)
	);
	return {
		memory: row,
		albums: listAlbums(sql).map((album) => ({ ...album, containsMemory: selected.has(album.id) }))
	};
};

export const actions: Actions = {
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
