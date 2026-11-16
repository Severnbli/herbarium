import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { audit } from '#lib/server/audit.ts';
import { db, isSetupDone } from '#lib/server/app.ts';
import { createFirstOwner, MemberError } from '#lib/server/auth/members.ts';
import { hashPassword } from '#lib/server/auth/password.ts';
import { checkLimit, limitKey, recordFailure } from '#lib/server/auth/rate-limit.ts';
import * as fields from '#lib/server/auth/schemas.ts';
import { removeSetupCode, verifySetupCode } from '#lib/server/auth/setup.ts';
import { getConfig } from '#lib/server/config.ts';
import { clientIp, minutesUntil, startSession } from '#lib/server/http/request.ts';
import type { Actions, PageServerLoad } from './$types';

const schema = z
	.strictObject({
		code: z.string().trim().min(1).max(64),
		username: fields.username,
		displayName: fields.displayName,
		password: fields.newPassword,
		confirmPassword: z.string().max(1024),
		acknowledge: z.literal('on', { error: 'acknowledge' })
	})
	.refine((value) => value.password === value.confirmPassword, { path: ['confirmPassword'] });

export const load: PageServerLoad = () => {
	// Setup runs only once; afterwards the page does not exist.
	if (isSetupDone()) error(404, 'not_found');
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		if (isSetupDone()) error(404, 'not_found');
		const ip = clientIp(event);
		const keys = [limitKey('setup', ip)];
		const limit = checkLimit(db(), keys);
		if (limit.limited) {
			return fail(429, {
				problem: 'rate_limited' as const,
				minutes: minutesUntil(limit.retryAfterMs)
			});
		}

		const form = await event.request.formData();
		const parsed = fields.parseForm(schema, form);
		const values = {
			username: String(form.get('username') ?? ''),
			displayName: String(form.get('displayName') ?? '')
		};
		if (!parsed.success)
			return fail(400, { problem: 'invalid' as const, fields: parsed.fields, values });

		const { dataDir } = getConfig();
		if (!verifySetupCode(dataDir, parsed.data.code)) {
			recordFailure(db(), keys);
			return fail(400, { problem: 'invalid' as const, fields: ['code'], values });
		}

		let userId: string;
		try {
			userId = createFirstOwner(db(), {
				username: parsed.data.username,
				displayName: parsed.data.displayName,
				passwordHash: await hashPassword(parsed.data.password)
			});
		} catch (e) {
			if (e instanceof MemberError) error(404, 'not_found');
			throw e;
		}
		removeSetupCode(dataDir);
		audit(db(), 'setup_completed', { actorId: userId, ip });
		audit(db(), 'login_succeeded', { actorId: userId, ip });
		startSession(event, userId);
		redirect(303, '/');
	}
};
