import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { audit } from '#lib/server/audit.ts';
import { db, keys } from '#lib/server/app.ts';
import { clearSessionCookie } from '#lib/server/auth/cookies.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { confirmPassword } from '#lib/server/auth/login.ts';
import { findUserById, updatePasswordHash } from '#lib/server/auth/members.ts';
import { hashPassword } from '#lib/server/auth/password.ts';
import { qrPath } from '#lib/server/auth/qr.ts';
import * as fields from '#lib/server/auth/schemas.ts';
import {
	deleteUserSession,
	listSessions,
	revokeUserSessions,
	type SessionUser
} from '#lib/server/auth/session.ts';
import {
	beginTotpSetup,
	confirmTotpSetup,
	disableTotp,
	openSecret,
	remainingRecoveryCodes,
	replaceRecoveryCodes,
	totpUri
} from '#lib/server/auth/totp.ts';
import { clientIp, minutesUntil, startSession } from '#lib/server/http/request.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	const user = requireUser(event);
	const currentId = event.locals.session?.id;
	return {
		now: Date.now(),
		totpEnabled: user.totpEnabled,
		recoveryCodesLeft: user.totpEnabled ? remainingRecoveryCodes(db(), user.id) : 0,
		sessions: listSessions(db(), user.id).map((session) => ({
			id: session.id,
			current: session.id === currentId,
			lastSeenAt: session.lastSeenAt.getTime(),
			device: describeDevice(session.userAgent)
		}))
	};
};

/** A short, recognisable device description from the user agent, e.g. "Firefox, Linux". */
function describeDevice(userAgent: string | null): string | null {
	if (!userAgent) return null;
	const browser = /(Edg|OPR|Firefox|Chrome|Safari)\//.exec(userAgent)?.[1];
	const os = /(Android|iPhone|iPad|Windows|Mac OS X|Linux)/.exec(userAgent)?.[1];
	const names: Record<string, string> = { Edg: 'Edge', OPR: 'Opera', 'Mac OS X': 'macOS' };
	const parts = [browser, os].filter((part): part is string => !!part).map((p) => names[p] ?? p);
	return parts.length > 0 ? parts.join(', ') : null;
}

/** Replaces the current session with a fresh one after a privilege-relevant change. */
function rotate(event: RequestEvent, user: SessionUser) {
	if (event.locals.session) deleteUserSession(db(), user.id, event.locals.session.id);
	startSession(event, user.id);
}

/** Parses the form and checks the password typed again for a sensitive action. */
async function reauthenticate<T extends z.ZodType>(
	event: RequestEvent,
	user: SessionUser,
	schema: T,
	section: string
) {
	const parsed = fields.parseForm(schema, await event.request.formData());
	if (!parsed.success) {
		return { failure: fail(400, { section, problem: 'invalid' as const, fields: parsed.fields }) };
	}
	const password = (parsed.data as { currentPassword: string }).currentPassword;
	const check = await confirmPassword(db(), user.id, password, clientIp(event));
	if (!check.ok) {
		return {
			failure:
				check.reason === 'rate_limited'
					? fail(429, {
							section,
							problem: 'rate_limited' as const,
							minutes: minutesUntil(check.retryAfterMs)
						})
					: fail(400, {
							section,
							problem: 'invalid' as const,
							fields: ['currentPassword']
						})
		};
	}
	return { data: parsed.data as z.output<T> };
}

const passwordOnly = z.strictObject({ currentPassword: fields.currentPassword });

function totpSetupView(secret: string, uri: string) {
	return { secret: secret.match(/.{1,4}/g)?.join(' ') ?? secret, qr: qrPath(uri) };
}

export const actions: Actions = {
	changePassword: async (event) => {
		const user = requireUser(event);
		const schema = z
			.strictObject({
				currentPassword: fields.currentPassword,
				password: fields.newPassword,
				confirmPassword: z.string().max(1024)
			})
			.refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'] });
		const result = await reauthenticate(event, user, schema, 'password');
		if (result.failure) return result.failure;

		updatePasswordHash(db(), user.id, await hashPassword(result.data.password));
		// Every other session ends; this device continues with a new token.
		revokeUserSessions(db(), user.id);
		startSession(event, user.id);
		audit(db(), 'password_changed', { actorId: user.id, ip: clientIp(event) });
		return { section: 'password', done: 'password_changed' as const };
	},

	revokeSession: async (event) => {
		const user = requireUser(event);
		const parsed = fields.parseForm(
			z.strictObject({ id: z.string().regex(/^[0-9a-f]{64}$/) }),
			await event.request.formData()
		);
		if (!parsed.success || !deleteUserSession(db(), user.id, parsed.data.id)) {
			return fail(400, { section: 'sessions', problem: 'invalid' as const, fields: [] });
		}
		audit(db(), 'session_revoked', { actorId: user.id, ip: clientIp(event) });
		if (parsed.data.id === event.locals.session?.id) {
			clearSessionCookie(event.cookies);
			redirect(303, '/login');
		}
		return { section: 'sessions' };
	},

	signOutEverywhere: (event) => {
		const user = requireUser(event);
		revokeUserSessions(db(), user.id);
		audit(db(), 'sessions_revoked_all', { actorId: user.id, ip: clientIp(event) });
		clearSessionCookie(event.cookies);
		redirect(303, '/login');
	},

	totpBegin: async (event) => {
		const user = requireUser(event);
		// Replacing an active secret goes through "turn off" first, never silently.
		if (user.totpEnabled) {
			return fail(400, { section: 'totp', problem: 'invalid' as const, fields: [] });
		}
		const result = await reauthenticate(event, user, passwordOnly, 'totp');
		if (result.failure) return result.failure;
		const { secret, uri } = beginTotpSetup(db(), keys().field, user.id, user.username);
		return { section: 'totp', setup: totpSetupView(secret, uri) };
	},

	totpConfirm: async (event) => {
		const user = requireUser(event);
		const parsed = fields.parseForm(
			z.strictObject({ code: fields.otpCode }),
			await event.request.formData()
		);
		const codes = parsed.success
			? confirmTotpSetup(db(), keys().field, user.id, parsed.data.code)
			: null;
		if (!codes) {
			// Show the same pending secret again, so the member can retry without starting over.
			const row = findUserById(db(), user.id);
			if (!row?.totpPendingSecret) {
				return fail(400, { section: 'totp', problem: 'invalid' as const, fields: [] });
			}
			const secret = openSecret(keys().field, user.id, row.totpPendingSecret);
			const uri = totpUri(secret, user.username);
			return fail(400, {
				section: 'totp',
				problem: 'invalid' as const,
				fields: ['code'],
				setup: totpSetupView(secret, uri)
			});
		}
		audit(db(), 'totp_enabled', { actorId: user.id, ip: clientIp(event) });
		rotate(event, user);
		return { section: 'totp', done: 'totp_enabled' as const, recoveryCodes: codes };
	},

	totpDisable: async (event) => {
		const user = requireUser(event);
		const result = await reauthenticate(event, user, passwordOnly, 'totp');
		if (result.failure) return result.failure;
		disableTotp(db(), user.id);
		audit(db(), 'totp_disabled', { actorId: user.id, ip: clientIp(event) });
		rotate(event, user);
		return { section: 'totp', done: 'totp_disabled' as const };
	},

	recoveryCodes: async (event) => {
		const user = requireUser(event);
		const result = await reauthenticate(event, user, passwordOnly, 'recovery');
		if (result.failure) return result.failure;
		if (!user.totpEnabled)
			return fail(400, { section: 'recovery', problem: 'invalid' as const, fields: [] });
		const codes = replaceRecoveryCodes(db(), user.id);
		audit(db(), 'recovery_codes_regenerated', { actorId: user.id, ip: clientIp(event) });
		return { section: 'recovery', recoveryCodes: codes };
	}
};
