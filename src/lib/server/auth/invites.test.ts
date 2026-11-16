import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/index';
import { invite } from '../db/schema';
import { createTestDb } from '../testing';
import { addUser } from './fixtures';
import {
	acceptInvite,
	createInvite,
	findUsableInvite,
	INVITE_LIFETIME_MS,
	InviteError,
	listInvites,
	revokeInvite
} from './invites';
import { findUserById, MemberError } from './members';

let db: Db;
let cleanup: () => void;
let owner: string;
beforeEach(async () => {
	({ db, cleanup } = createTestDb());
	owner = await addUser(db, 'alice', { role: 'owner' });
});
afterEach(() => cleanup());

const t0 = new Date('2026-01-01T00:00:00Z');
const newMember = (username: string) => ({ username, displayName: username, passwordHash: 'h' });

describe('invites', () => {
	it('store only the token hash', () => {
		const { token } = createInvite(db, owner, 'for Bob', t0);
		expect(JSON.stringify(db.select().from(invite).all())).not.toContain(token);
	});

	it('create a member account exactly once', () => {
		const { token } = createInvite(db, owner, null, t0);
		expect(findUsableInvite(db, token, t0)).toBeDefined();
		const { userId } = acceptInvite(db, token, newMember('bob'), t0);
		const bob = findUserById(db, userId);
		expect(bob?.role).toBe('member');
		expect(bob?.invitedBy).toBe(owner);

		expect(findUsableInvite(db, token, t0)).toBeUndefined();
		expect(() => acceptInvite(db, token, newMember('mallory'), t0)).toThrow(InviteError);
		expect(listInvites(db, t0)[0]?.status).toBe('used');
	});

	it('expire', () => {
		const { token } = createInvite(db, owner, null, t0);
		const later = new Date(t0.getTime() + INVITE_LIFETIME_MS);
		expect(findUsableInvite(db, token, later)).toBeUndefined();
		expect(() => acceptInvite(db, token, newMember('bob'), later)).toThrow(InviteError);
		expect(listInvites(db, later)[0]?.status).toBe('expired');
	});

	it('can be revoked while unused', () => {
		const { token, publicId } = createInvite(db, owner, null, t0);
		expect(revokeInvite(db, publicId, t0)).toBe(true);
		expect(revokeInvite(db, publicId, t0)).toBe(false);
		expect(() => acceptInvite(db, token, newMember('bob'), t0)).toThrow(InviteError);
		expect(listInvites(db, t0)[0]?.status).toBe('revoked');
	});

	it('stay usable when the chosen username is taken', () => {
		const { token } = createInvite(db, owner, null, t0);
		expect(() => acceptInvite(db, token, newMember('alice'), t0)).toThrow(MemberError);
		expect(findUsableInvite(db, token, t0)).toBeDefined();
	});

	it('reject malformed and unknown tokens', () => {
		expect(findUsableInvite(db, '../../etc/passwd', t0)).toBeUndefined();
		expect(() => acceptInvite(db, 'x'.repeat(43), newMember('bob'), t0)).toThrow(InviteError);
	});
});
