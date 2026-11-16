import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/index';
import { createTestDb } from '../testing';
import {
	backoffMs,
	checkLimit,
	clearFailures,
	limitKey,
	POLICIES,
	recordFailure
} from './rate-limit';

let db: Db;
let cleanup: () => void;
beforeEach(() => ({ db, cleanup } = createTestDb()));
afterEach(() => cleanup());

const t0 = new Date('2026-01-01T00:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);

describe('backoff', () => {
	it('is free at first, then doubles up to the cap', () => {
		const policy = POLICIES.account;
		expect(backoffMs(policy, policy.freeAttempts)).toBe(0);
		expect(backoffMs(policy, policy.freeAttempts + 1)).toBe(policy.baseDelayMs);
		expect(backoffMs(policy, policy.freeAttempts + 2)).toBe(policy.baseDelayMs * 2);
		expect(backoffMs(policy, policy.freeAttempts + 3)).toBe(policy.baseDelayMs * 4);
		expect(backoffMs(policy, 1000)).toBe(policy.maxDelayMs);
	});
});

describe('rate limiting', () => {
	const key = limitKey('account', 'alice');

	it('locks a key after the free attempts', () => {
		for (let i = 0; i < POLICIES.account.freeAttempts; i++) {
			expect(checkLimit(db, [key], t0).limited).toBe(false);
			recordFailure(db, [key], t0);
		}
		expect(checkLimit(db, [key], t0).limited).toBe(false);
		recordFailure(db, [key], t0);
		const result = checkLimit(db, [key], t0);
		expect(result).toEqual({ limited: true, retryAfterMs: POLICIES.account.baseDelayMs });
		expect(checkLimit(db, [key], at(POLICIES.account.baseDelayMs)).limited).toBe(false);
	});

	it('locks if any of several keys is locked', () => {
		for (let i = 0; i <= POLICIES.account.freeAttempts; i++) recordFailure(db, [key], t0);
		expect(checkLimit(db, [limitKey('ip', '1.2.3.4'), key], t0).limited).toBe(true);
		expect(checkLimit(db, [limitKey('ip', '1.2.3.4')], t0).limited).toBe(false);
	});

	it('forgets failures after the quiet period', () => {
		for (let i = 0; i <= POLICIES.account.freeAttempts + 3; i++) recordFailure(db, [key], t0);
		const later = at(POLICIES.account.resetAfterMs + POLICIES.account.maxDelayMs + 1);
		expect(checkLimit(db, [key], later).limited).toBe(false);
		recordFailure(db, [key], later);
		expect(checkLimit(db, [key], later).limited).toBe(false);
	});

	it('clears a key on success', () => {
		for (let i = 0; i <= POLICIES.account.freeAttempts; i++) recordFailure(db, [key], t0);
		clearFailures(db, [key]);
		expect(checkLimit(db, [key], t0).limited).toBe(false);
	});

	it('rejects unknown policies', () => {
		expect(() => recordFailure(db, ['nope:x'], t0)).toThrow();
	});
});
