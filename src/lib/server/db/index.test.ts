import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../testing';
import { DatabaseKeyError, openDatabase } from './index';
import { user } from './schema';

let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

describe('encrypted database', () => {
	it('applies the migrations', () => {
		const t = createTestDb();
		cleanup = t.cleanup;
		expect(t.db.select().from(user).all()).toEqual([]);
	});

	it('is unreadable without the key', () => {
		const t = createTestDb();
		cleanup = t.cleanup;
		t.db
			.insert(user)
			.values({
				id: 'u1',
				username: 'marker-username',
				displayName: 'Marker Display Name',
				passwordHash: 'x'
			})
			.run();

		const bytes = readFileSync(t.path);
		expect(bytes.subarray(0, 16).toString('latin1')).not.toContain('SQLite format');
		expect(bytes.includes('marker-username')).toBe(false);
		expect(bytes.includes('Marker Display Name')).toBe(false);

		const plain = new Database(t.path);
		expect(() => plain.prepare('SELECT * FROM user').all()).toThrow();
		plain.close();
	});

	it('refuses a wrong key', () => {
		const t = createTestDb();
		cleanup = t.cleanup;
		expect(() => openDatabase({ path: t.path, key: randomBytes(32) })).toThrow(DatabaseKeyError);
	});

	it('reopens with the right key', () => {
		const t = createTestDb();
		cleanup = t.cleanup;
		t.db
			.insert(user)
			.values({ id: 'u1', username: 'a', displayName: 'A', passwordHash: 'x' })
			.run();
		const again = openDatabase({ path: t.path, key: t.key });
		expect(again.db.select().from(user).all()).toHaveLength(1);
		again.close();
	});
});
