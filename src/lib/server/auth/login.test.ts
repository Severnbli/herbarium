import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/index';
import { auditLog, user } from '../db/schema';
import { createTestDb } from '../testing';
import { addUser } from './fixtures';
import { attemptLogin, confirmPassword, verifySecondFactor } from './login';
import { POLICIES } from './rate-limit';

let db: Db;
let cleanup: () => void;
let alice: string;
const password = 'a long test password';
beforeEach(async () => {
	({ db, cleanup } = createTestDb());
	alice = await addUser(db, 'alice', { password });
});
afterEach(() => cleanup());

const t0 = new Date('2026-01-01T00:00:00Z');
const ip = '203.0.113.7';

describe('attemptLogin', () => {
	it('accepts the right password', async () => {
		expect(await attemptLogin(db, { username: 'alice', password, ip }, t0)).toEqual({
			ok: true,
			userId: alice,
			mfaRequired: false
		});
	});

	it('fails identically for a wrong password and an unknown account', async () => {
		const wrong = await attemptLogin(db, { username: 'alice', password: 'nope', ip }, t0);
		const unknown = await attemptLogin(db, { username: 'nobody', password, ip }, t0);
		expect(wrong).toEqual({ ok: false, reason: 'invalid' });
		expect(unknown).toEqual(wrong);
	});

	it('locks out deactivated members even with the right password', async () => {
		db.update(user).set({ deactivatedAt: t0 }).where(eq(user.id, alice)).run();
		expect(await attemptLogin(db, { username: 'alice', password, ip }, t0)).toEqual({
			ok: false,
			reason: 'invalid'
		});
	});

	it('rate-limits an account, existing or not, even with the right password', async () => {
		for (const username of ['alice', 'nobody']) {
			for (let i = 0; i <= POLICIES.account.freeAttempts; i++) {
				await attemptLogin(db, { username, password: 'nope', ip: `10.0.0.${i}` }, t0);
			}
			const result = await attemptLogin(db, { username, password, ip: '10.1.1.1' }, t0);
			expect(result).toMatchObject({ ok: false, reason: 'rate_limited' });
		}
	});

	it('rate-limits a client address across accounts', async () => {
		for (let i = 0; i <= POLICIES.ip.freeAttempts; i++) {
			await attemptLogin(db, { username: `user${i}`, password: 'nope', ip }, t0);
		}
		const result = await attemptLogin(db, { username: 'alice', password, ip }, t0);
		expect(result).toMatchObject({ ok: false, reason: 'rate_limited' });
	});

	it('audits without storing the attempted password or username', async () => {
		await attemptLogin(db, { username: 'nobody', password: 'secret-guess', ip }, t0);
		await attemptLogin(db, { username: 'alice', password, ip }, t0);
		const log = JSON.stringify(db.select().from(auditLog).all());
		expect(log).toContain('login_failed');
		expect(log).not.toContain('secret-guess');
		expect(log).not.toContain('nobody');
		expect(log).not.toContain(password);
	});

	it('asks for the second factor when TOTP is on', async () => {
		db.update(user)
			.set({ totpSecret: Buffer.from('x') })
			.where(eq(user.id, alice))
			.run();
		expect(await attemptLogin(db, { username: 'alice', password, ip }, t0)).toMatchObject({
			ok: true,
			mfaRequired: true
		});
	});
});

describe('verifySecondFactor', () => {
	it('rate-limits wrong codes', () => {
		const key = randomBytes(32);
		for (let i = 0; i <= POLICIES.mfa.freeAttempts; i++) {
			verifySecondFactor(db, key, alice, { recoveryCode: 'WRONG' }, ip, t0);
		}
		expect(verifySecondFactor(db, key, alice, { recoveryCode: 'WRONG' }, ip, t0)).toMatchObject({
			reason: 'rate_limited'
		});
	});
});

describe('confirmPassword', () => {
	it('checks the password and rate-limits guesses', async () => {
		expect(await confirmPassword(db, alice, password, ip, t0)).toEqual({ ok: true });
		for (let i = 0; i <= POLICIES.reauth.freeAttempts; i++) {
			await confirmPassword(db, alice, 'nope', ip, t0);
		}
		expect(await confirmPassword(db, alice, password, ip, t0)).toMatchObject({
			reason: 'rate_limited'
		});
	});
});
