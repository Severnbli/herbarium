import { fail, redirect } from '@sveltejs/kit';
import { db, keys } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { getConfig } from '#lib/server/config.ts';
import { hasBasemap } from '#lib/server/maps/assets.ts';
import { offerCoordinates } from '#lib/server/media/coordinates.ts';
import { uploadDestination } from '#lib/server/media/destination.ts';
import { UploadError, uploadStatus } from '#lib/server/media/process.ts';
import { uploadMemory } from '#lib/server/media/upload.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (request) => {
	requireUser(request);
	const target = uploadDestination(db(), request.request, request.url);
	const config = getConfig();
	return {
		target:
			target.kind === 'gallery'
				? target
				: { kind: target.kind, id: target.id, title: target.title },
		basemap: target.kind === 'event' && target.lat === null && (await hasBasemap(config.dataDir)),
		maxFileBytes: config.limits.maxFileBytes
	};
};

export const actions: Actions = {
	default: async (request) => {
		const actor = requireUser(request);
		const sql = db();
		const target = uploadDestination(sql, request.request, request.url);
		const eventId = target.kind === 'event' ? target.id : null;
		const config = getConfig();
		try {
			const uploaded = await uploadMemory(
				request.request,
				{ db: sql, config, wrappingKey: keys().keyWrap },
				actor.id,
				eventId,
				{ albumId: target.kind === 'album' ? target.id : null }
			);
			if (uploaded.status !== 'uploaded') throw new UploadError('invalid');
			if (target.kind === 'event' && target.lat === null && uploaded.coordinates) {
				return {
					suggestion: {
						id: uploaded.id,
						token: offerCoordinates(
							keys().field,
							request.locals.session!.id,
							uploaded.id,
							target.id,
							uploaded.coordinates
						),
						...uploaded.coordinates
					}
				};
			}
			if (target.kind === 'album') redirect(303, `/memories/albums/${target.id}`);
			redirect(303, `/memories/${uploaded.id}`);
		} catch (cause) {
			if (cause instanceof UploadError)
				return fail(uploadStatus[cause.code], { problem: cause.code });
			throw cause;
		}
	}
};
