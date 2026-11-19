import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../crypto/tokens';
import type { Db } from '../db/index';
import { session, user } from '../db/schema';
import { createTestDb } from '../testing';
import { addUser } from './fixtures';
import {
	createSession,
	deleteUserSession,
	listSessions,
	MFA_PENDING_MS,
	pruneSessions,
	revokeUserSessions,
	SESSION_ABSOLUTE_MS,
	SESSION_IDLE_MS,
	validateSession
} from './session';

let db: Db;
let cleanup: () => void;
let userId: string;
beforeEach(async () => {
	({ db, cleanup } = createTestDb());
	userId = await addUser(db, 'alice');
});
afterEach(() => cleanup());

const t0 = new Date('2026-01-01T00:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);
const DAY = 24 * 60 * 60 * 1000;

describe('sessions', () => {
	it('store only the token hash', () => {
		const { token } = createSession(db, userId, { now: t0 });
		const rows = db.select().from(session).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.id).toBe(hashToken(token));
		expect(JSON.stringify(rows)).not.toContain(token);
	});

	it('validate a fresh token and reject unknown or malformed ones', () => {
		const { token } = createSession(db, userId, { now: t0 });
		expect(validateSession(db, token, t0)?.user.username).toBe('alice');
		expect(validateSession(db, 'x'.repeat(43), t0)).toBeNull();
		expect(validateSession(db, 'short', t0)).toBeNull();
		expect(validateSession(db, `${token}'; DROP TABLE user;--`, t0)).toBeNull();
	});

	it('expire after the idle timeout', () => {
		const { token } = createSession(db, userId, { now: t0 });
		expect(validateSession(db, token, at(SESSION_IDLE_MS + 1))).toBeNull();
		expect(db.select().from(session).all()).toHaveLength(0);
	});

	it('stay alive with activity, but not past the absolute lifetime', () => {
		const { token } = createSession(db, userId, { now: t0 });
		for (let day = 1; day * DAY < SESSION_ABSOLUTE_MS; day++) {
			expect(validateSession(db, token, at(day * DAY))).not.toBeNull();
		}
		expect(validateSession(db, token, at(SESSION_ABSOLUTE_MS))).toBeNull();
	});

	it('end when the member is deactivated', () => {
		const { token } = createSession(db, userId, { now: t0 });
		db.update(user).set({ deactivatedAt: t0 }).where(eq(user.id, userId)).run();
		expect(validateSession(db, token, t0)).toBeNull();
	});

	it('pending second-factor sessions expire quickly', () => {
		const { token } = createSession(db, userId, { now: t0, mfaPending: true });
		expect(validateSession(db, token, t0)?.mfaPending).toBe(true);
		expect(validateSession(db, token, at(MFA_PENDING_MS + 1))).toBeNull();
	});

	it('can be revoked one by one or all at once', () => {
		const a = createSession(db, userId, { now: t0 });
		const b = createSession(db, userId, { now: t0 });
		const c = createSession(db, userId, { now: t0 });
		const other = createSession(db, userId, { now: t0 });

		expect(deleteUserSession(db, 'someone-else', hashToken(a.token))).toBe(false);
		expect(deleteUserSession(db, userId, hashToken(a.token))).toBe(true);
		expect(validateSession(db, a.token, t0)).toBeNull();

		expect(revokeUserSessions(db, userId, hashToken(other.token))).toBe(2);
		expect(validateSession(db, b.token, t0)).toBeNull();
		expect(validateSession(db, c.token, t0)).toBeNull();
		expect(validateSession(db, other.token, t0)).not.toBeNull();
		expect(listSessions(db, userId)).toHaveLength(1);
	});

	it('prune old rows', () => {
		createSession(db, userId, { now: t0 });
		pruneSessions(db, at(SESSION_ABSOLUTE_MS + 1));
		expect(db.select().from(session).all()).toHaveLength(0);
	});
});
