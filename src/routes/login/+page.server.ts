import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { audit } from '#lib/server/audit.ts';
import { db } from '#lib/server/app.ts';
import { safeNext } from '#lib/server/auth/guard.ts';
import { attemptLogin } from '#lib/server/auth/login.ts';
import * as fields from '#lib/server/auth/schemas.ts';
import { deleteSession } from '#lib/server/auth/session.ts';
import { clientIp, minutesUntil, startSession } from '#lib/server/http/request.ts';
import type { Actions, PageServerLoad } from './$types';

const schema = z.strictObject({
	// Not the strict username rule: any input fails the same generic way.
	username: z.string().trim().toLowerCase().min(1).max(64),
	password: fields.currentPassword,
	next: z.string().max(512).optional()
});

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, safeNext(url.searchParams.get('next')));
	return { next: safeNext(url.searchParams.get('next')) };
};

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const username = String(form.get('username') ?? '').slice(0, 64);
		const parsed = fields.parseForm(schema, form);
		if (!parsed.success) return fail(400, { problem: 'invalid' as const, username });

		const ip = clientIp(event);
		const result = await attemptLogin(db(), {
			username: parsed.data.username,
			password: parsed.data.password,
			ip
		});
		if (!result.ok) {
			return result.reason === 'rate_limited'
				? fail(429, {
						problem: 'rate_limited' as const,
						minutes: minutesUntil(result.retryAfterMs),
						username
					})
				: fail(400, { problem: 'invalid' as const, username });
		}

		// Rotate: whatever session the browser had is dropped, the new one gets a fresh token.
		if (event.locals.session) deleteSession(db(), event.locals.session.id);
		const next = safeNext(parsed.data.next);
		if (result.mfaRequired) {
			startSession(event, result.userId, { mfaPending: true });
			redirect(303, `/login/verify?next=${encodeURIComponent(next)}`);
		}
		audit(db(), 'login_succeeded', { actorId: result.userId, ip });
		startSession(event, result.userId);
		redirect(303, next);
	}
};
