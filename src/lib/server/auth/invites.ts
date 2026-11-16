import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { generateId, generateToken, hashToken } from '../crypto/tokens.ts';
import type { Db } from '../db/index.ts';
import { invite, user } from '../db/schema.ts';
import { insertUser, MemberError } from './members.ts';

const DAY = 24 * 60 * 60 * 1000;
export const INVITE_LIFETIME_MS = 7 * DAY;

export class InviteError extends Error {
	constructor(public readonly code: 'invalid_invite') {
		super(code);
		this.name = 'InviteError';
	}
}

/** Issues an invite. The token is returned once for the link; only its hash is stored. */
export function createInvite(
	db: Db,
	createdBy: string,
	label: string | null,
	now = new Date()
): { token: string; publicId: string; expiresAt: Date } {
	const token = generateToken();
	const publicId = generateId();
	const expiresAt = new Date(now.getTime() + INVITE_LIFETIME_MS);
	db.insert(invite)
		.values({ id: hashToken(token), publicId, label, createdBy, createdAt: now, expiresAt })
		.run();
	return { token, publicId, expiresAt };
}

const usable = (now: Date) =>
	and(isNull(invite.usedAt), isNull(invite.revokedAt), gt(invite.expiresAt, now));

/** Returns the invite if the token is unused, unrevoked and unexpired. Does not consume it. */
export function findUsableInvite(db: Db, token: string, now = new Date()) {
	if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
	return db
		.select({ publicId: invite.publicId, expiresAt: invite.expiresAt })
		.from(invite)
		.where(and(eq(invite.id, hashToken(token)), usable(now)))
		.get();
}

/**
 * Creates a member account from an invite. Consuming the invite and creating the account happen
 * in one transaction, so a token can be used exactly once.
 */
export function acceptInvite(
	db: Db,
	token: string,
	values: { username: string; displayName: string; passwordHash: string },
	now = new Date()
): { userId: string; invitedBy: string } {
	if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new InviteError('invalid_invite');
	return db.transaction((tx) => {
		const row = tx
			.select()
			.from(invite)
			.where(and(eq(invite.id, hashToken(token)), usable(now)))
			.get();
		if (!row) throw new InviteError('invalid_invite');
		// Throws MemberError('username_taken') before the invite is marked used.
		const userId = insertUser(tx, { ...values, role: 'member', invitedBy: row.createdBy }, now);
		const result = tx
			.update(invite)
			.set({ usedAt: now, usedBy: userId })
			.where(and(eq(invite.id, row.id), usable(now)))
			.run();
		if (result.changes !== 1) throw new InviteError('invalid_invite');
		return { userId, invitedBy: row.createdBy };
	});
}

/** Revokes an unused invite. Returns whether one was revoked. */
export function revokeInvite(db: Db, publicId: string, now = new Date()): boolean {
	const result = db
		.update(invite)
		.set({ revokedAt: now })
		.where(and(eq(invite.publicId, publicId), isNull(invite.usedAt), isNull(invite.revokedAt)))
		.run();
	return result.changes > 0;
}

export type InviteStatus = 'pending' | 'used' | 'revoked' | 'expired';

/** Invites for the members page, newest first, with the name of whoever issued them. */
export function listInvites(db: Db, now = new Date()) {
	return db
		.select({
			publicId: invite.publicId,
			label: invite.label,
			createdAt: invite.createdAt,
			expiresAt: invite.expiresAt,
			usedAt: invite.usedAt,
			revokedAt: invite.revokedAt,
			createdByName: user.displayName
		})
		.from(invite)
		.innerJoin(user, eq(invite.createdBy, user.id))
		.orderBy(desc(invite.createdAt))
		.limit(50)
		.all()
		.map((row) => ({
			...row,
			status: (row.usedAt
				? 'used'
				: row.revokedAt
					? 'revoked'
					: row.expiresAt <= now
						? 'expired'
						: 'pending') satisfies InviteStatus as InviteStatus
		}));
}

export { MemberError };
