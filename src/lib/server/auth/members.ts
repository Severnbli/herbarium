import { and, count, eq, isNull, ne } from 'drizzle-orm';
import { generateId } from '../crypto/tokens.ts';
import type { Db } from '../db/index.ts';
import { user, type Role } from '../db/schema.ts';
import { revokeUserSessions } from './session.ts';

export class MemberError extends Error {
	constructor(
		public readonly code:
			'username_taken' | 'not_found' | 'last_owner' | 'cannot_deactivate_self' | 'already_set_up'
	) {
		super(code);
		this.name = 'MemberError';
	}
}

export function countUsers(db: Db): number {
	return db.select({ n: count() }).from(user).get()?.n ?? 0;
}

export function findUserByUsername(db: Db, name: string) {
	return db.select().from(user).where(eq(user.username, name)).get();
}

export function findUserById(db: Db, id: string) {
	return db.select().from(user).where(eq(user.id, id)).get();
}

interface NewUser {
	username: string;
	displayName: string;
	passwordHash: string;
}

/** Inserts a user inside a transaction the caller controls. */
export function insertUser(
	db: Db,
	values: NewUser & { role: Role; invitedBy: string | null },
	now = new Date()
): string {
	if (db.select({ id: user.id }).from(user).where(eq(user.username, values.username)).get()) {
		throw new MemberError('username_taken');
	}
	const id = generateId();
	db.insert(user)
		.values({ id, ...values, createdAt: now, passwordChangedAt: now })
		.run();
	return id;
}

/** Creates the first owner. Fails if any account exists, so setup can run only once. */
export function createFirstOwner(db: Db, values: NewUser, now = new Date()): string {
	return db.transaction((tx) => {
		if (countUsers(tx) > 0) throw new MemberError('already_set_up');
		return insertUser(tx, { ...values, role: 'owner', invitedBy: null }, now);
	});
}

export function listMembers(db: Db) {
	return db
		.select({
			id: user.id,
			username: user.username,
			displayName: user.displayName,
			role: user.role,
			deactivatedAt: user.deactivatedAt,
			createdAt: user.createdAt
		})
		.from(user)
		.orderBy(user.createdAt)
		.all();
}

function activeOwnersExcept(db: Db, userId: string): number {
	return (
		db
			.select({ n: count() })
			.from(user)
			.where(and(eq(user.role, 'owner'), isNull(user.deactivatedAt), ne(user.id, userId)))
			.get()?.n ?? 0
	);
}

/** Deactivates a member and revokes all their sessions at once. */
export function deactivateMember(db: Db, actorId: string, targetId: string, now = new Date()) {
	db.transaction((tx) => {
		if (actorId === targetId) throw new MemberError('cannot_deactivate_self');
		const target = findUserById(tx, targetId);
		if (!target) throw new MemberError('not_found');
		if (target.deactivatedAt) return;
		if (target.role === 'owner' && activeOwnersExcept(tx, targetId) === 0) {
			throw new MemberError('last_owner');
		}
		tx.update(user).set({ deactivatedAt: now }).where(eq(user.id, targetId)).run();
		revokeUserSessions(tx, targetId);
	});
}

export function reactivateMember(db: Db, targetId: string) {
	const result = db.update(user).set({ deactivatedAt: null }).where(eq(user.id, targetId)).run();
	if (result.changes === 0) throw new MemberError('not_found');
}

/** Promotes or demotes a member. At least one active owner always remains. */
export function setRole(db: Db, targetId: string, role: Role) {
	db.transaction((tx) => {
		const target = findUserById(tx, targetId);
		if (!target) throw new MemberError('not_found');
		if (target.role === role) return;
		if (role === 'member' && activeOwnersExcept(tx, targetId) === 0) {
			throw new MemberError('last_owner');
		}
		tx.update(user).set({ role }).where(eq(user.id, targetId)).run();
	});
}

export function updatePasswordHash(db: Db, userId: string, passwordHash: string, now = new Date()) {
	db.update(user).set({ passwordHash, passwordChangedAt: now }).where(eq(user.id, userId)).run();
}
