import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { audit } from '#lib/server/audit.ts';
import { db, keys } from '#lib/server/app.ts';
import { clearSessionCookie } from '#lib/server/auth/cookies.ts';
import { safeNext } from '#lib/server/auth/guard.ts';
import { verifySecondFactor } from '#lib/server/auth/login.ts';
import * as fields from '#lib/server/auth/schemas.ts';
import { deleteSession, validateSession } from '#lib/server/auth/session.ts';
import { sessionCookieName } from '#lib/server/auth/cookies.ts';
import { clientIp, minutesUntil, startSession } from '#lib/server/http/request.ts';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/** The user waiting for their second factor, or a redirect back to the password step. */
function pendingUser(event: RequestEvent) {
	const token = event.cookies.get(sessionCookieName());
	const session = token ? validateSession(db(), token) : null;
	if (!session?.mfaPending) redirect(303, '/login');
	return session;
}

const codeSchema = z.strictObject({ code: fields.otpCode, next: z.string().max(512).optional() });
const recoverySchema = z.strictObject({
	recoveryCode: fields.recoveryCodeInput,
	next: z.string().max(512).optional()
});

async function verify(event: RequestEvent, kind: 'code' | 'recovery') {
	const pending = pendingUser(event);
	const form = await event.request.formData();
	const parsed =
		kind === 'code' ? fields.parseForm(codeSchema, form) : fields.parseForm(recoverySchema, form);
	if (!parsed.success) return fail(400, { problem: 'invalid' as const, kind });

	const ip = clientIp(event);
	const data = parsed.data;
	const result = verifySecondFactor(
		db(),
		keys().field,
		pending.user.id,
		'code' in data ? { code: data.code } : { recoveryCode: data.recoveryCode },
		ip
	);
	if (!result.ok) {
		return result.reason === 'rate_limited'
			? fail(429, {
					problem: 'rate_limited' as const,
					minutes: minutesUntil(result.retryAfterMs),
					kind
				})
			: fail(400, { problem: 'invalid' as const, kind });
	}

	// The pending session is replaced by a full one with a new token.
	deleteSession(db(), pending.id);
	audit(db(), 'login_succeeded', { actorId: pending.user.id, ip, details: { mfa: true } });
	startSession(event, pending.user.id);
	redirect(303, safeNext(data.next));
}

export const load: PageServerLoad = (event) => {
	pendingUser(event);
	return { next: safeNext(event.url.searchParams.get('next')) };
};

export const actions: Actions = {
	code: (event) => verify(event, 'code'),
	recovery: (event) => verify(event, 'recovery'),
	restart: (event) => {
		if (event.locals.session) deleteSession(db(), event.locals.session.id);
		clearSessionCookie(event.cookies);
		redirect(303, '/login');
	}
};
