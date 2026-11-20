import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '#lib/server/db/index.ts';
import { event } from '#lib/server/db/schema.ts';
import { findAlbum, queryFields } from './gallery.ts';
import { mediaId } from './store.ts';

const query = z
	.strictObject({ event: mediaId.optional(), album: mediaId.optional() })
	.refine(({ event, album }) => !(event && album));

export function uploadDestination(db: Db, request: Request, url: URL) {
	const parsed = query.safeParse(queryFields(request, url));
	if (!parsed.success) error(400, 'Invalid memory query');
	if (parsed.data.album) return { kind: 'album' as const, ...findAlbum(db, parsed.data.album) };
	if (parsed.data.event) {
		const row = db
			.select({ id: event.id, title: event.title, lat: event.lat })
			.from(event)
			.where(eq(event.id, parsed.data.event))
			.get();
		if (!row) error(404, 'Event unavailable');
		return { kind: 'event' as const, ...row };
	}
	return { kind: 'gallery' as const };
}
