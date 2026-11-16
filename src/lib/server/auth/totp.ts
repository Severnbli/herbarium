import { and, eq, isNull } from 'drizzle-orm';
import { Secret, TOTP } from 'otpauth';
import { open, seal } from '../crypto/keys.ts';
import { generateHumanCode, hashToken, normalizeHumanCode } from '../crypto/tokens.ts';
import type { Db } from '../db/index.ts';
import { recoveryCode, user } from '../db/schema.ts';

/**
 * Optional TOTP second factor (RFC 6238: SHA-1, 6 digits, 30 s – what every authenticator app
 * supports). Secrets are sealed with the `field` key on top of the database encryption.
 */

const PERIOD = 30;
const ISSUER = 'Herbarium';
export const RECOVERY_CODE_COUNT = 10;

const sealContext = (userId: string) => `totp-secret:${userId}`;

function totpFor(secret: Secret, label: string) {
	return new TOTP({ issuer: ISSUER, label, algorithm: 'SHA1', digits: 6, period: PERIOD, secret });
}

export function sealSecret(fieldKey: Buffer, userId: string, base32: string): Buffer {
	return seal(fieldKey, Buffer.from(base32, 'utf8'), sealContext(userId));
}

export function openSecret(fieldKey: Buffer, userId: string, sealed: Buffer): string {
	return open(fieldKey, sealed, sealContext(userId)).toString('utf8');
}

/** Starts 2FA setup: stores a new pending secret and returns it for the authenticator app. */
export function beginTotpSetup(db: Db, fieldKey: Buffer, userId: string, username: string) {
	const secret = new Secret({ size: 20 });
	db.update(user)
		.set({ totpPendingSecret: sealSecret(fieldKey, userId, secret.base32) })
		.where(eq(user.id, userId))
		.run();
	return { secret: secret.base32, uri: totpFor(secret, username).toString() };
}

/**
 * Checks a code against a base32 secret, allowing one step of clock drift. Returns the accepted
 * time step, or null.
 */
export function verifyTotp(base32: string, code: string, now = new Date()): number | null {
	const totp = totpFor(Secret.fromBase32(base32), '');
	const delta = totp.validate({ token: code, timestamp: now.getTime(), window: 1 });
	if (delta === null) return null;
	return Math.floor(now.getTime() / 1000 / PERIOD) + delta;
}

/** Confirms setup with a first code. Returns fresh recovery codes, or null if the code is wrong. */
export function confirmTotpSetup(
	db: Db,
	fieldKey: Buffer,
	userId: string,
	code: string,
	now = new Date()
): string[] | null {
	const row = db.select().from(user).where(eq(user.id, userId)).get();
	if (!row?.totpPendingSecret) return null;
	const counter = verifyTotp(openSecret(fieldKey, userId, row.totpPendingSecret), code, now);
	if (counter === null) return null;
	return db.transaction((tx) => {
		tx.update(user)
			.set({ totpSecret: row.totpPendingSecret, totpPendingSecret: null, totpLastCounter: counter })
			.where(eq(user.id, userId))
			.run();
		return replaceRecoveryCodes(tx, userId);
	});
}

export function disableTotp(db: Db, userId: string): void {
	db.transaction((tx) => {
		tx.update(user)
			.set({ totpSecret: null, totpPendingSecret: null, totpLastCounter: null })
			.where(eq(user.id, userId))
			.run();
		tx.delete(recoveryCode).where(eq(recoveryCode.userId, userId)).run();
	});
}

/** Verifies a login code and records its time step, so the same code cannot be used twice. */
export function checkLoginTotp(
	db: Db,
	fieldKey: Buffer,
	userId: string,
	code: string,
	now = new Date()
): boolean {
	const row = db.select().from(user).where(eq(user.id, userId)).get();
	if (!row?.totpSecret) return false;
	const counter = verifyTotp(openSecret(fieldKey, userId, row.totpSecret), code, now);
	if (counter === null || (row.totpLastCounter !== null && counter <= row.totpLastCounter)) {
		return false;
	}
	db.update(user).set({ totpLastCounter: counter }).where(eq(user.id, userId)).run();
	return true;
}

/** Replaces all recovery codes of a user and returns the new ones (shown once, stored hashed). */
export function replaceRecoveryCodes(db: Db, userId: string): string[] {
	const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateHumanCode(12));
	db.delete(recoveryCode).where(eq(recoveryCode.userId, userId)).run();
	db.insert(recoveryCode)
		.values(codes.map((code) => ({ userId, codeHash: hashToken(normalizeHumanCode(code)) })))
		.run();
	return codes;
}

/** Consumes a recovery code. Each code works once. */
export function useRecoveryCode(db: Db, userId: string, input: string, now = new Date()): boolean {
	const codeHash = hashToken(normalizeHumanCode(input));
	const result = db
		.update(recoveryCode)
		.set({ usedAt: now })
		.where(
			and(
				eq(recoveryCode.userId, userId),
				eq(recoveryCode.codeHash, codeHash),
				isNull(recoveryCode.usedAt)
			)
		)
		.run();
	return result.changes === 1;
}

export function remainingRecoveryCodes(db: Db, userId: string): number {
	return db
		.select({ id: recoveryCode.id })
		.from(recoveryCode)
		.where(and(eq(recoveryCode.userId, userId), isNull(recoveryCode.usedAt)))
		.all().length;
}
