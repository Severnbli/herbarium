import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { loginAttempt } from '../db/schema.ts';

/**
 * Failure-based rate limiting with exponential backoff, stored in the database so it survives
 * restarts. A key is locked once its free attempts are used up; every further failure doubles the
 * lockout up to a cap. Counters reset after a quiet period.
 */
export interface Policy {
	freeAttempts: number;
	baseDelayMs: number;
	maxDelayMs: number;
	/** Failures older than this are forgotten. */
	resetAfterMs: number;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export const POLICIES = {
	/** Per login name, whether the account exists or not. */
	account: {
		freeAttempts: 5,
		baseDelayMs: 2 * SECOND,
		maxDelayMs: 15 * MINUTE,
		resetAfterMs: 24 * HOUR
	},
	/** Per client address, across all accounts. */
	ip: { freeAttempts: 20, baseDelayMs: 2 * SECOND, maxDelayMs: HOUR, resetAfterMs: 24 * HOUR },
	/** Second-factor codes per user. */
	mfa: {
		freeAttempts: 5,
		baseDelayMs: 5 * SECOND,
		maxDelayMs: 15 * MINUTE,
		resetAfterMs: 24 * HOUR
	},
	/** Password confirmation for sensitive actions, per user. */
	reauth: {
		freeAttempts: 5,
		baseDelayMs: 2 * SECOND,
		maxDelayMs: 15 * MINUTE,
		resetAfterMs: 24 * HOUR
	},
	/** First-run setup code, per client address. */
	setup: { freeAttempts: 5, baseDelayMs: 5 * SECOND, maxDelayMs: HOUR, resetAfterMs: 24 * HOUR }
} satisfies Record<string, Policy>;

export type PolicyName = keyof typeof POLICIES;

export const limitKey = (policy: PolicyName, subject: string) => `${policy}:${subject}`;

function policyOf(key: string): Policy {
	const name = key.slice(0, key.indexOf(':')) as PolicyName;
	const policy = POLICIES[name];
	if (!policy) throw new Error('Unknown rate limit policy');
	return policy;
}

export function backoffMs(policy: Policy, failures: number): number {
	const excess = failures - policy.freeAttempts;
	if (excess <= 0) return 0;
	return Math.min(policy.baseDelayMs * 2 ** (excess - 1), policy.maxDelayMs);
}

export type LimitResult = { limited: false } | { limited: true; retryAfterMs: number };

/** Checks whether any of the keys is currently locked. */
export function checkLimit(db: Db, keys: string[], now = new Date()): LimitResult {
	const rows = db.select().from(loginAttempt).where(inArray(loginAttempt.key, keys)).all();
	let retryAfterMs = 0;
	for (const row of rows) {
		if (row.lockedUntil && row.lockedUntil > now) {
			retryAfterMs = Math.max(retryAfterMs, row.lockedUntil.getTime() - now.getTime());
		}
	}
	return retryAfterMs > 0 ? { limited: true, retryAfterMs } : { limited: false };
}

/** Counts a failure for each key and sets its lockout. */
export function recordFailure(db: Db, keys: string[], now = new Date()): void {
	db.transaction((tx) => {
		for (const key of keys) {
			const policy = policyOf(key);
			const row = tx.select().from(loginAttempt).where(eq(loginAttempt.key, key)).get();
			const stale = !row || now.getTime() - row.lastFailureAt.getTime() > policy.resetAfterMs;
			const failures = stale ? 1 : row.failures + 1;
			const delay = backoffMs(policy, failures);
			const values = {
				failures,
				lastFailureAt: now,
				lockedUntil: delay > 0 ? new Date(now.getTime() + delay) : null
			};
			tx.insert(loginAttempt)
				.values({ key, ...values })
				.onConflictDoUpdate({ target: loginAttempt.key, set: values })
				.run();
		}
		// Forget counters that are long expired, so the table stays small.
		const cutoff = new Date(now.getTime() - 24 * HOUR);
		tx.delete(loginAttempt)
			.where(
				and(
					lt(loginAttempt.lastFailureAt, cutoff),
					or(isNull(loginAttempt.lockedUntil), lt(loginAttempt.lockedUntil, now))
				)
			)
			.run();
	});
}

export function clearFailures(db: Db, keys: string[]): void {
	db.delete(loginAttempt).where(inArray(loginAttempt.key, keys)).run();
}
