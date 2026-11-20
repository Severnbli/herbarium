import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, keys } from '#lib/server/app.ts';
import { sessionCookieName } from '#lib/server/auth/cookies.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { validateSession } from '#lib/server/auth/session.ts';
import { getConfig } from '#lib/server/config.ts';
import { offerCoordinates } from '#lib/server/media/coordinates.ts';
import { uploadDestination } from '#lib/server/media/destination.ts';
import { UploadError, uploadStatus } from '#lib/server/media/process.ts';
import { uploadMemory } from '#lib/server/media/upload.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (request) => {
	const actor = requireUser(request);
	const config = getConfig();
	if (request.request.headers.get('origin') !== config.origin.origin) error(403, 'Invalid origin');
	const key = z.uuidv4().safeParse(request.request.headers.get('x-herbarium-upload'));
	if (!key.success) error(400, 'Invalid upload request');

	const sql = db();
	const target = uploadDestination(sql, request.request, request.url);
	const eventId = target.kind === 'event' ? target.id : null;
	const sessionId = request.locals.session!.id;
	try {
		const result = await uploadMemory(
			request.request,
			{ db: sql, config, wrappingKey: keys().keyWrap },
			actor.id,
			eventId,
			{
				albumId: target.kind === 'album' ? target.id : null,
				receipt: {
					key: key.data,
					destination: target.kind === 'gallery' ? target.kind : `${target.kind}:${target.id}`,
					requireSession: () => {
						const session = validateSession(sql, request.cookies.get(sessionCookieName()) ?? '');
						if (
							!session ||
							session.mfaPending ||
							session.id !== sessionId ||
							session.user.id !== actor.id
						)
							error(401, 'Session expired');
					}
				}
			}
		);
		if (result.status !== 'uploaded') return json(result);
		const coordinates = target.kind === 'event' && target.lat === null ? result.coordinates : null;
		return json(
			{
				id: result.id,
				status: result.status,
				suggestion: coordinates && {
					...coordinates,
					token: offerCoordinates(keys().field, sessionId, result.id, eventId, coordinates)
				}
			},
			{ status: 201 }
		);
	} catch (cause) {
		if (cause instanceof UploadError)
			return json({ problem: cause.code }, { status: uploadStatus[cause.code] });
		throw cause;
	}
};
