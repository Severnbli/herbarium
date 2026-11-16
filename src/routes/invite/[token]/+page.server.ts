import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { audit } from '#lib/server/audit.ts';
import { db } from '#lib/server/app.ts';
import { acceptInvite, findUsableInvite, InviteError } from '#lib/server/auth/invites.ts';
import { MemberError } from '#lib/server/auth/members.ts';
import { hashPassword } from '#lib/server/auth/password.ts';
import * as fields from '#lib/server/auth/schemas.ts';
import { deleteSession } from '#lib/server/auth/session.ts';
import { clientIp, startSession } from '#lib/server/http/request.ts';
import type { Actions, PageServerLoad } from './$types';

const schema = z
	.strictObject({
		username: fields.username,
		displayName: fields.displayName,
		password: fields.newPassword,
		confirmPassword: z.string().max(1024)
	})
	.refine((value) => value.password === value.confirmPassword, { path: ['confirmPassword'] });

export const load: PageServerLoad = ({ params, setHeaders }) => {
	// The token is in the URL: keep the page out of every cache.
	setHeaders({ 'cache-control': 'no-store' });
	return { valid: findUsableInvite(db(), params.token) !== undefined };
};

export const actions: Actions = {
	default: async (event) => {
		const { token } = event.params;
		// Check before hashing, so invalid links cannot make the server burn CPU on argon2.
		if (!findUsableInvite(db(), token)) return fail(410, { problem: 'invalid_invite' as const });

		const form = await event.request.formData();
		const values = {
			username: String(form.get('username') ?? '').slice(0, 64),
			displayName: String(form.get('displayName') ?? '').slice(0, 64)
		};
		const parsed = fields.parseForm(schema, form);
		if (!parsed.success) {
			return fail(400, { problem: 'invalid' as const, fields: parsed.fields, values });
		}

		let result: { userId: string; invitedBy: string };
		try {
			result = acceptInvite(db(), token, {
				username: parsed.data.username,
				displayName: parsed.data.displayName,
				passwordHash: await hashPassword(parsed.data.password)
			});
		} catch (e) {
			if (e instanceof InviteError) return fail(410, { problem: 'invalid_invite' as const });
			if (e instanceof MemberError && e.code === 'username_taken') {
				return fail(400, { problem: 'username_taken' as const, fields: ['username'], values });
			}
			throw e;
		}

		const ip = clientIp(event);
		audit(db(), 'invite_accepted', { actorId: result.userId, targetId: result.invitedBy, ip });
		audit(db(), 'login_succeeded', { actorId: result.userId, ip });
		if (event.locals.session) deleteSession(db(), event.locals.session.id);
		startSession(event, result.userId);
		redirect(303, '/');
	}
};
