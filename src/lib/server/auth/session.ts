import { and, eq, lt, ne, or } from 'drizzle-orm';
import { generateToken, hashToken } from '../crypto/tokens.ts';
import type { Db } from '../db/index.ts';
import { session, user } from '../db/schema.ts';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** A session ends after this long without activity… */
export const SESSION_IDLE_MS = 14 * DAY;
/** …and in any case this long after sign-in. */
export const SESSION_ABSOLUTE_MS = 60 * DAY;
/** Time to enter the second factor after a correct password. */
export const MFA_PENDING_MS = 5 * MINUTE;
/** `last_seen_at` is written at most this often, to keep reads cheap. */
const TOUCH_INTERVAL_MS = MINUTE;

export type SessionUser = Pick<
	typeof user.$inferSelect,
	'id' | 'username' | 'displayName' | 'role'
> & { totpEnabled: boolean };

export interface ValidSession {
	id: string;
	mfaPending: boolean;
	expiresAt: Date;
	user: SessionUser;
}

export interface CreateSessionOptions {
	mfaPending?: boolean;
	userAgent?: string | null;
	now?: Date;
}

/** Creates a session and returns the token for the cookie. Only its hash is stored. */
export function createSession(
	db: Db,
	userId: string,
	{ mfaPending = false, userAgent = null, now = new Date() }: CreateSessionOptions = {}
): { token: string; expiresAt: Date } {
	const token = generateToken();
	const lifetime = mfaPending ? MFA_PENDING_MS : SESSION_ABSOLUTE_MS;
	const expiresAt = new Date(now.getTime() + lifetime);
	db.insert(session)
		.values({
			id: hashToken(token),
			userId,
			mfaPending,
			createdAt: now,
			lastSeenAt: now,
			expiresAt,
			userAgent: userAgent?.slice(0, 200) ?? null
		})
		.run();
	return { token, expiresAt };
}

/**
 * Resolves a cookie token to a live session. Expired sessions, idle sessions and sessions of
 * deactivated members are deleted and yield null.
 */
export function validateSession(db: Db, token: string, now = new Date()): ValidSession | null {
	if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
	const id = hashToken(token);
	const row = db
		.select({ session, user })
		.from(session)
		.innerJoin(user, eq(session.userId, user.id))
		.where(eq(session.id, id))
		.get();
	if (!row) return null;

	const idleLimit = row.session.mfaPending ? MFA_PENDING_MS : SESSION_IDLE_MS;
	const expired =
		row.session.expiresAt <= now ||
		now.getTime() - row.session.lastSeenAt.getTime() > idleLimit ||
		row.user.deactivatedAt !== null;
	if (expired) {
		db.delete(session).where(eq(session.id, id)).run();
		return null;
	}

	if (now.getTime() - row.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
		db.update(session).set({ lastSeenAt: now }).where(eq(session.id, id)).run();
	}

	return {
		id,
		mfaPending: row.session.mfaPending,
		expiresAt: row.session.expiresAt,
		user: {
			id: row.user.id,
			username: row.user.username,
			displayName: row.user.displayName,
			role: row.user.role,
			totpEnabled: row.user.totpSecret !== null
		}
	};
}

export function deleteSession(db: Db, sessionId: string): void {
	db.delete(session).where(eq(session.id, sessionId)).run();
}

/** Deletes a session only if it belongs to the given user. Returns whether one was deleted. */
export function deleteUserSession(db: Db, userId: string, sessionId: string): boolean {
	const result = db
		.delete(session)
		.where(and(eq(session.id, sessionId), eq(session.userId, userId)))
		.run();
	return result.changes > 0;
}

/** Revokes all sessions of a user, optionally keeping one (the current device). */
export function revokeUserSessions(db: Db, userId: string, exceptSessionId?: string): number {
	const condition = exceptSessionId
		? and(eq(session.userId, userId), ne(session.id, exceptSessionId))
		: eq(session.userId, userId);
	return db.delete(session).where(condition).run().changes;
}

export function listSessions(db: Db, userId: string) {
	return db
		.select({
			id: session.id,
			createdAt: session.createdAt,
			lastSeenAt: session.lastSeenAt,
			userAgent: session.userAgent
		})
		.from(session)
		.where(and(eq(session.userId, userId), eq(session.mfaPending, false)))
		.orderBy(session.lastSeenAt)
		.all()
		.reverse();
}

/** Removes sessions that ended long ago; called opportunistically. */
export function pruneSessions(db: Db, now = new Date()): void {
	db.delete(session)
		.where(
			or(
				lt(session.expiresAt, now),
				lt(session.lastSeenAt, new Date(now.getTime() - SESSION_IDLE_MS)),
				and(
					eq(session.mfaPending, true),
					lt(session.lastSeenAt, new Date(now.getTime() - MFA_PENDING_MS))
				)
			)
		)
		.run();
}
