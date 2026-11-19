import { redirect } from '@sveltejs/kit';
import { audit } from '#lib/server/audit.ts';
import { db } from '#lib/server/app.ts';
import { clearSessionCookie } from '#lib/server/auth/cookies.ts';
import { deleteSession } from '#lib/server/auth/session.ts';
import { clientIp } from '#lib/server/http/request.ts';
import type { RequestHandler } from './$types';

/** Signing out is a POST (from the navigation form); GET never changes state. */
export const POST: RequestHandler = (event) => {
	const { session, user } = event.locals;
	if (session) {
		deleteSession(db(), session.id);
		audit(db(), 'logout', { actorId: user?.id ?? null, ip: clientIp(event) });
	}
	clearSessionCookie(event.cookies);
	redirect(303, '/login');
};
