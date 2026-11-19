import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/index.ts';
import { createTestDb } from '../testing.ts';
import { addUser } from './fixtures.ts';
import { findUserById } from './members.ts';
import { localeSchema, updateLocale } from './preferences.ts';
import { createSession, validateSession } from './session.ts';

let db: Db;
let cleanup: () => void;
beforeEach(() => ({ db, cleanup } = createTestDb()));
afterEach(() => cleanup());

describe('language preference', () => {
	it('defaults to browser detection and applies a saved choice to existing sessions', async () => {
		const alice = await addUser(db, 'alice');
		const bob = await addUser(db, 'bob');
		const session = createSession(db, alice);
		expect(validateSession(db, session.token)?.user.locale).toBeNull();
		updateLocale(db, alice, 'be');
		expect(findUserById(db, alice)?.locale).toBe('be');
		expect(validateSession(db, session.token)?.user.locale).toBe('be');
		expect(findUserById(db, bob)?.locale).toBeNull();
	});

	it('rejects unsupported locales and unknown fields', () => {
		expect(localeSchema.safeParse({ locale: 'be' }).success).toBe(true);
		expect(localeSchema.safeParse({ locale: 'de' }).success).toBe(false);
		expect(localeSchema.safeParse({ locale: 'be', userId: 'someone-else' }).success).toBe(false);
		expect(localeSchema.safeParse({}).success).toBe(false);
	});
});
