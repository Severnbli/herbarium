import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, keys } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { getConfig } from '#lib/server/config.ts';
import { event } from '#lib/server/db/schema.ts';
import { hasBasemap } from '#lib/server/maps/assets.ts';
import { offerCoordinates } from '#lib/server/media/coordinates.ts';
import { queryFields } from '#lib/server/media/gallery.ts';
import { UploadError, uploadStatus } from '#lib/server/media/process.ts';
import { mediaId } from '#lib/server/media/store.ts';
import { uploadMemory } from '#lib/server/media/upload.ts';
import type { Actions, PageServerLoad } from './$types';

const query = z.strictObject({ event: mediaId.optional() });

function target(request: Request, url: URL) {
	const parsed = query.safeParse(queryFields(request, url));
	if (!parsed.success) error(400, 'Invalid memory query');
	if (!parsed.data.event) return null;
	const row = db()
		.select({ id: event.id, title: event.title, lat: event.lat })
		.from(event)
		.where(eq(event.id, parsed.data.event))
		.get();
	if (!row) error(404, 'Event unavailable');
	return row;
}

export const load: PageServerLoad = (request) => {
	requireUser(request);
	const row = target(request.request, request.url);
	return {
		event: row && { id: row.id, title: row.title },
		maxFileBytes: getConfig().limits.maxFileBytes
	};
};

export const actions: Actions = {
	default: async (request) => {
		const actor = requireUser(request);
		const row = target(request.request, request.url);
		let uploaded: Awaited<ReturnType<typeof uploadMemory>>;
		try {
			uploaded = await uploadMemory(
				request.request,
				{ db: db(), config: getConfig(), wrappingKey: keys().keyWrap },
				actor.id,
				row?.id ?? null
			);
		} catch (cause) {
			if (cause instanceof UploadError)
				return fail(uploadStatus[cause.code], { problem: cause.code });
			throw cause;
		}
		if (row && row.lat === null && uploaded.coordinates) {
			return {
				suggestion: {
					basemap: await hasBasemap(getConfig().dataDir),
					id: uploaded.id,
					token: offerCoordinates(
						keys().field,
						request.locals.session!.id,
						uploaded.id,
						uploaded.coordinates
					),
					...uploaded.coordinates
				}
			};
		}
		redirect(303, `/memories/${uploaded.id}`);
	}
};
