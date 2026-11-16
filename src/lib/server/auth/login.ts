import { audit } from '../audit.ts';
import type { Db } from '../db/index.ts';
import { findUserById, findUserByUsername, updatePasswordHash } from './members.ts';
import { hashPassword, needsRehash, verifyDummy, verifyPassword } from './password.ts';
import { checkLimit, clearFailures, limitKey, recordFailure } from './rate-limit.ts';
import { checkLoginTotp, useRecoveryCode } from './totp.ts';

export type CheckResult =
	| { ok: true }
	| { ok: false; reason: 'invalid' }
	| { ok: false; reason: 'rate_limited'; retryAfterMs: number };

export type LoginResult =
	{ ok: true; userId: string; mfaRequired: boolean } | Exclude<CheckResult, { ok: true }>;

/**
 * Checks a username and password. Unknown accounts, deactivated accounts and wrong passwords all
 * fail the same way and take the same time, so the result never reveals whether an account exists.
 */
export async function attemptLogin(
	db: Db,
	input: { username: string; password: string; ip: string },
	now = new Date()
): Promise<LoginResult> {
	const keys = [limitKey('account', input.username), limitKey('ip', input.ip)];
	const limit = checkLimit(db, keys, now);
	if (limit.limited) {
		audit(db, 'login_rate_limited', { ip: input.ip }, now);
		return { ok: false, reason: 'rate_limited', retryAfterMs: limit.retryAfterMs };
	}

	const account = findUserByUsername(db, input.username);
	const valid = account
		? await verifyPassword(account.passwordHash, input.password)
		: await verifyDummy(input.password);

	if (!account || !valid || account.deactivatedAt) {
		recordFailure(db, keys, now);
		audit(db, 'login_failed', { actorId: account?.id ?? null, ip: input.ip }, now);
		return { ok: false, reason: 'invalid' };
	}

	clearFailures(db, [keys[0] as string]);
	if (needsRehash(account.passwordHash)) {
		updatePasswordHash(
			db,
			account.id,
			await hashPassword(input.password),
			account.passwordChangedAt ?? now
		);
	}
	return { ok: true, userId: account.id, mfaRequired: account.totpSecret !== null };
}

/** Checks a TOTP code or a recovery code for a user who passed the password step. */
export function verifySecondFactor(
	db: Db,
	fieldKey: Buffer,
	userId: string,
	input: { code: string } | { recoveryCode: string },
	ip: string,
	now = new Date()
): CheckResult {
	const keys = [limitKey('mfa', userId), limitKey('ip', ip)];
	const limit = checkLimit(db, keys, now);
	if (limit.limited) {
		audit(db, 'login_rate_limited', { actorId: userId, ip }, now);
		return { ok: false, reason: 'rate_limited', retryAfterMs: limit.retryAfterMs };
	}
	const ok =
		'code' in input
			? checkLoginTotp(db, fieldKey, userId, input.code, now)
			: useRecoveryCode(db, userId, input.recoveryCode, now);
	if (!ok) {
		recordFailure(db, keys, now);
		audit(db, 'mfa_failed', { actorId: userId, ip }, now);
		return { ok: false, reason: 'invalid' };
	}
	clearFailures(db, [keys[0] as string]);
	if ('recoveryCode' in input) audit(db, 'recovery_code_used', { actorId: userId, ip }, now);
	return { ok: true };
}

/**
 * Re-authentication for sensitive actions: the member types their password again. Rate-limited
 * per user, so a stolen session cannot be used to guess the password.
 */
export async function confirmPassword(
	db: Db,
	userId: string,
	password: string,
	ip: string,
	now = new Date()
): Promise<CheckResult> {
	const keys = [limitKey('reauth', userId)];
	const limit = checkLimit(db, keys, now);
	if (limit.limited) return { ok: false, reason: 'rate_limited', retryAfterMs: limit.retryAfterMs };
	const account = findUserById(db, userId);
	if (!account || !(await verifyPassword(account.passwordHash, password))) {
		recordFailure(db, keys, now);
		audit(db, 'reauth_failed', { actorId: userId, ip }, now);
		return { ok: false, reason: 'invalid' };
	}
	clearFailures(db, keys);
	return { ok: true };
}
