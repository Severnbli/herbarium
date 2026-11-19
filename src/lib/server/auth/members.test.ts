import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/index';
import { createTestDb } from '../testing';
import { addUser } from './fixtures';
import {
	countUsers,
	createFirstOwner,
	deactivateMember,
	findUserById,
	MemberError,
	reactivateMember,
	setRole
} from './members';
import { createSession, validateSession } from './session';

let db: Db;
let cleanup: () => void;
beforeEach(() => ({ db, cleanup } = createTestDb()));
afterEach(() => cleanup());

const codeOf = (fn: () => unknown) => {
	try {
		fn();
	} catch (error) {
		if (error instanceof MemberError) return error.code;
		throw error;
	}
	return 'no error';
};

describe('first owner', () => {
	it('can be created exactly once', () => {
		const id = createFirstOwner(db, { username: 'alice', displayName: 'Alice', passwordHash: 'h' });
		expect(findUserById(db, id)?.role).toBe('owner');
		expect(
			codeOf(() =>
				createFirstOwner(db, { username: 'mallory', displayName: 'M', passwordHash: 'h' })
			)
		).toBe('already_set_up');
		expect(countUsers(db)).toBe(1);
	});
});

describe('member management', () => {
	it('deactivation revokes all sessions immediately', async () => {
		const owner = await addUser(db, 'alice', { role: 'owner' });
		const bob = await addUser(db, 'bob');
		const s1 = createSession(db, bob);
		const s2 = createSession(db, bob);
		deactivateMember(db, owner, bob);
		expect(validateSession(db, s1.token)).toBeNull();
		expect(validateSession(db, s2.token)).toBeNull();
		expect(findUserById(db, bob)?.deactivatedAt).not.toBeNull();

		reactivateMember(db, bob);
		expect(findUserById(db, bob)?.deactivatedAt).toBeNull();
		// Old sessions stay revoked after reactivation.
		expect(validateSession(db, s1.token)).toBeNull();
	});

	it('keeps at least one active owner', async () => {
		const alice = await addUser(db, 'alice', { role: 'owner' });
		const bob = await addUser(db, 'bob', { role: 'owner' });
		const carol = await addUser(db, 'carol');

		expect(codeOf(() => deactivateMember(db, alice, alice))).toBe('cannot_deactivate_self');
		deactivateMember(db, alice, bob);
		expect(codeOf(() => setRole(db, alice, 'member'))).toBe('last_owner');

		setRole(db, carol, 'owner');
		setRole(db, alice, 'member');
		expect(findUserById(db, alice)?.role).toBe('member');
		expect(codeOf(() => deactivateMember(db, alice, carol))).toBe('last_owner');
		expect(codeOf(() => setRole(db, carol, 'member'))).toBe('last_owner');
	});

	it('does not count deactivated owners', async () => {
		const alice = await addUser(db, 'alice', { role: 'owner' });
		const bob = await addUser(db, 'bob', { role: 'owner' });
		deactivateMember(db, alice, bob);
		expect(codeOf(() => setRole(db, alice, 'member'))).toBe('last_owner');
	});

	it('reports unknown members', () => {
		expect(codeOf(() => setRole(db, 'nobody', 'owner'))).toBe('not_found');
		expect(codeOf(() => reactivateMember(db, 'nobody'))).toBe('not_found');
	});
});
