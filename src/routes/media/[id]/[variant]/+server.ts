import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, keys } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { getConfig } from '#lib/server/config.ts';
import { MEDIA_VARIANTS, mediaFile, memory } from '#lib/server/db/schema.ts';
import { mediaResponse } from '#lib/server/media/response.ts';
import { mediaId } from '#lib/server/media/store.ts';
import type { RequestHandler } from './$types';

const route = z.strictObject({ id: mediaId, variant: z.enum(MEDIA_VARIANTS) });

export const GET: RequestHandler = (event) => {
	requireUser(event);
	const parsed = route.safeParse(event.params);
	if (!parsed.success) error(404, 'Media unavailable');
	const query = event.url.searchParams;
	const download = query.size === 1 && query.get('download') === '1';
	if (query.size && !download) error(400, 'Invalid media query');
	const { id, variant } = parsed.data;
	const row = db()
		.select({ asset: mediaFile, originalName: memory.originalName })
		.from(mediaFile)
		.innerJoin(memory, eq(mediaFile.memoryId, memory.id))
		.where(and(eq(mediaFile.memoryId, id), eq(mediaFile.variant, variant)))
		.get();
	if (!row) error(404, 'Media unavailable');
	return mediaResponse(
		event.request,
		getConfig().dataDir,
		keys().keyWrap,
		{ ...row.asset, originalName: row.originalName },
		download
	);
};

export const HEAD = GET;
