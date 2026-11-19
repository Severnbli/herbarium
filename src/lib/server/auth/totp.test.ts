import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Secret, TOTP } from 'otpauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/index';
import { user } from '../db/schema';
import { createTestDb } from '../testing';
import { addUser } from './fixtures';
import {
	beginTotpSetup,
	checkLoginTotp,
	confirmTotpSetup,
	disableTotp,
	remainingRecoveryCodes,
	useRecoveryCode,
	verifyTotp
} from './totp';

let db: Db;
let cleanup: () => void;
let userId: string;
const fieldKey = randomBytes(32);
beforeEach(async () => {
	({ db, cleanup } = createTestDb());
	userId = await addUser(db, 'alice');
});
afterEach(() => cleanup());

const t0 = new Date('2026-01-01T00:00:00Z');
const codeAt = (secret: string, date: Date) =>
	new TOTP({ secret: Secret.fromBase32(secret) }).generate({ timestamp: date.getTime() });

describe('TOTP', () => {
	it('accepts codes within one step of drift', () => {
		const { secret } = beginTotpSetup(db, fieldKey, userId, 'alice');
		expect(verifyTotp(secret, codeAt(secret, t0), t0)).not.toBeNull();
		expect(verifyTotp(secret, codeAt(secret, new Date(t0.getTime() - 30_000)), t0)).not.toBeNull();
		expect(verifyTotp(secret, codeAt(secret, new Date(t0.getTime() - 90_000)), t0)).toBeNull();
	});

	it('stores the secret sealed, not in plain text', () => {
		const { secret, uri } = beginTotpSetup(db, fieldKey, userId, 'alice');
		expect(uri).toMatch(/^otpauth:\/\/totp\/Herbarium:alice\?/);
		const row = db.select().from(user).where(eq(user.id, userId)).get();
		expect(row?.totpPendingSecret?.includes(secret)).toBe(false);
	});

	it('is enabled only by a correct first code, which yields recovery codes', () => {
		const { secret } = beginTotpSetup(db, fieldKey, userId, 'alice');
		expect(confirmTotpSetup(db, fieldKey, userId, '000000', t0)).toBeNull();
		const codes = confirmTotpSetup(db, fieldKey, userId, codeAt(secret, t0), t0);
		expect(codes).toHaveLength(10);
		expect(remainingRecoveryCodes(db, userId)).toBe(10);
	});

	it('rejects a replayed login code', () => {
		const { secret } = beginTotpSetup(db, fieldKey, userId, 'alice');
		confirmTotpSetup(db, fieldKey, userId, codeAt(secret, t0), t0);
		const later = new Date(t0.getTime() + 60_000);
		const code = codeAt(secret, later);
		expect(checkLoginTotp(db, fieldKey, userId, code, later)).toBe(true);
		expect(checkLoginTotp(db, fieldKey, userId, code, later)).toBe(false);
		// The setup code cannot be reused for login either.
		expect(checkLoginTotp(db, fieldKey, userId, codeAt(secret, t0), t0)).toBe(false);
	});

	it('recovery codes work once each, ignoring case and dashes', () => {
		const { secret } = beginTotpSetup(db, fieldKey, userId, 'alice');
		const codes = confirmTotpSetup(db, fieldKey, userId, codeAt(secret, t0), t0) ?? [];
		const first = codes[0] as string;
		expect(useRecoveryCode(db, userId, first.toLowerCase().replaceAll('-', ' '))).toBe(true);
		expect(useRecoveryCode(db, userId, first)).toBe(false);
		expect(useRecoveryCode(db, userId, 'AAAA-AAAA-AAAA')).toBe(false);
		expect(remainingRecoveryCodes(db, userId)).toBe(9);
	});

	it('can be disabled', () => {
		const { secret } = beginTotpSetup(db, fieldKey, userId, 'alice');
		const codes = confirmTotpSetup(db, fieldKey, userId, codeAt(secret, t0), t0) ?? [];
		disableTotp(db, userId);
		expect(checkLoginTotp(db, fieldKey, userId, codeAt(secret, t0), t0)).toBe(false);
		expect(useRecoveryCode(db, userId, codes[1] as string)).toBe(false);
	});
});
