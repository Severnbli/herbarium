import { error, type RequestEvent } from '@sveltejs/kit';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { MemoryCard } from '#lib/domain/memory.ts';
import type { Db } from '#lib/server/db/index.ts';
import { album, albumMemory, event, mediaFile, memory, user } from '#lib/server/db/schema.ts';
import { mediaId } from './store.ts';

const PAGE_SIZE = 24;
export const pageField = z
	.string()
	.regex(/^[1-9]\d{0,5}$/)
	.transform(Number)
	.optional();
export const albumTitle = z.strictObject({ title: z.string().trim().min(1).max(120) });

export function queryFields(request: Request, url: URL, actions: readonly string[] = []) {
	const query: Record<string, string> = Object.create(null);
	let action = false;
	for (const [key, value] of url.searchParams) {
		if (request.method === 'POST' && actions.includes(key) && value === '') {
			if (action) error(400, 'Invalid memory query');
			action = true;
			continue;
		}
		if (Object.hasOwn(query, key)) error(400, 'Invalid memory query');
		query[key] = value;
	}
	return query;
}

export function routeMediaId(params: unknown): string {
	const result = z.strictObject({ id: mediaId }).safeParse(params);
	if (!result.success) error(404, 'Memory unavailable');
	return result.data.id;
}

export function requireNoQuery(event: Pick<RequestEvent, 'request' | 'url'>, actions: string[]) {
	if (Object.keys(queryFields(event.request, event.url, actions)).length) {
		error(400, 'Invalid memory query');
	}
}

const card = {
	id: memory.id,
	originalName: memory.originalName,
	altText: memory.altText,
	caption: memory.caption,
	sortDate: memory.sortDate
};

export function listMemories(db: Db, filter: { albumId?: string; eventId?: string }, page = 1) {
	const query = db
		.select({ ...card, contentType: mediaFile.contentType })
		.from(memory)
		.innerJoin(
			mediaFile,
			and(eq(mediaFile.memoryId, memory.id), eq(mediaFile.variant, 'original'))
		);
	const scope = filter.albumId
		? query.innerJoin(
				albumMemory,
				and(eq(albumMemory.memoryId, memory.id), eq(albumMemory.albumId, filter.albumId))
			)
		: query;
	const rows = scope
		.where(filter.eventId ? eq(memory.eventId, filter.eventId) : undefined)
		.orderBy(desc(memory.sortDate), desc(memory.id))
		.limit(PAGE_SIZE + 1)
		.offset((page - 1) * PAGE_SIZE)
		.all();
	return {
		rows: rows.slice(0, PAGE_SIZE).map(({ contentType, ...row }): MemoryCard => ({
			...row,
			isVideo: contentType.startsWith('video/')
		})),
		page,
		hasNext: rows.length > PAGE_SIZE
	};
}

export function findMemory(db: Db, id: string) {
	const row = db
		.select({
			...card,
			captureDate: memory.captureDate,
			createdByName: user.displayName,
			contentType: mediaFile.contentType,
			eventId: memory.eventId,
			eventTitle: event.title
		})
		.from(memory)
		.innerJoin(mediaFile, and(eq(mediaFile.memoryId, memory.id), eq(mediaFile.variant, 'original')))
		.innerJoin(user, eq(user.id, memory.createdBy))
		.leftJoin(event, eq(event.id, memory.eventId))
		.where(eq(memory.id, id))
		.get();
	if (!row) error(404, 'Memory unavailable');
	const { contentType, ...data } = row;
	return { ...data, isVideo: contentType.startsWith('video/') };
}

export function listAlbums(db: Db) {
	return db
		.select({ id: album.id, title: album.title })
		.from(album)
		.orderBy(asc(album.title), asc(album.id))
		.all();
}

export function findAlbum(db: Db, id: string) {
	const row = db
		.select({ id: album.id, title: album.title })
		.from(album)
		.where(eq(album.id, id))
		.get();
	if (!row) error(404, 'Album unavailable');
	return row;
}
