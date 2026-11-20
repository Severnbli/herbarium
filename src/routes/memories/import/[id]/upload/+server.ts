import { error, json, type RequestEvent } from '@sveltejs/kit';
import { db, keys } from '#lib/server/app.ts';
import { sessionCookieName } from '#lib/server/auth/cookies.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { validateSession } from '#lib/server/auth/session.ts';
import { getConfig } from '#lib/server/config.ts';
import { offerCoordinates } from '#lib/server/media/coordinates.ts';
import {
	existingMediaFingerprintKey,
	importFingerprint,
	mediaFingerprintKey
} from '#lib/server/media/fingerprint.ts';
import { requireNoQuery, routeMediaId } from '#lib/server/media/gallery.ts';
import {
	browserFingerprint,
	checkImportFile,
	ImportError,
	requireImport
} from '#lib/server/media/imports.ts';
import { UploadError, uploadStatus } from '#lib/server/media/process.ts';
import { uploadMemory } from '#lib/server/media/upload.ts';
import type { RequestHandler } from './$types';

function input(request: RequestEvent) {
	const actor = requireUser(request);
	requireNoQuery(request, []);
	const id = routeMediaId(request.params);
	const raw = browserFingerprint.safeParse(request.request.headers.get('x-herbarium-upload'));
	if (!raw.success) error(400, 'Invalid import request');
	return { actor, id, browserKey: raw.data };
}

function importFailure(cause: unknown): Response {
	if (cause instanceof UploadError)
		return json({ problem: cause.code }, { status: uploadStatus[cause.code] });
	if (cause instanceof ImportError) {
		const status = { missing: 404, full: 409, coordinates: 409, session: 401 } as const;
		return json({ problem: cause.code }, { status: status[cause.code] });
	}
	throw cause;
}

export const GET: RequestHandler = (request) => {
	const { actor, id, browserKey } = input(request);
	try {
		requireImport(db(), id, actor.id);
		const mediaKey = existingMediaFingerprintKey(db());
		const saved =
			mediaKey && checkImportFile(db(), id, importFingerprint(mediaKey.key, id, browserKey));
		return json({ status: saved ?? 'ready' });
	} catch (cause) {
		return importFailure(cause);
	}
};

export const POST: RequestHandler = async (request) => {
	const { actor, id, browserKey } = input(request);
	const config = getConfig();
	if (request.request.headers.get('origin') !== config.origin.origin) error(403, 'Invalid origin');
	try {
		requireImport(db(), id, actor.id);
		const fingerprint = importFingerprint(mediaFingerprintKey(db()), id, browserKey);
		const saved = checkImportFile(db(), id, fingerprint);
		if (saved) return json({ status: saved });
		const sessionId = request.locals.session!.id;
		const result = await uploadMemory(
			request.request,
			{ db: db(), config, wrappingKey: keys().keyWrap },
			actor.id,
			null,
			{
				id,
				fingerprint,
				sessionActive: () => {
					const session = validateSession(db(), request.cookies.get(sessionCookieName()) ?? '');
					return (
						!!session &&
						!session.mfaPending &&
						session.id === sessionId &&
						session.user.id === actor.id
					);
				}
			}
		);
		if (result.status !== 'uploaded') return json(result);
		return json(
			{
				status: result.status,
				id: result.id,
				suggestion: result.coordinates && {
					...result.coordinates,
					token: offerCoordinates(keys().field, sessionId, result.id, null, result.coordinates)
				}
			},
			{ status: 201 }
		);
	} catch (cause) {
		return importFailure(cause);
	}
};
