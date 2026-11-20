import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../testing';
import { DatabaseKeyError, openDatabase } from './index';
import { event, eventReminder, memory, reminderDelivery, user } from './schema';

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

it('holds an exclusive maintenance lock between transactions', () => {
	const t = createTestDb();
	cleanup = t.cleanup;
	const path = t.path + '.maintenance';
	const maintenance = openDatabase({ path, key: t.key, exclusive: true });
	const reader = new Database(path, { timeout: 0 });
	try {
		reader.pragma("cipher = 'sqlcipher'");
		reader.pragma('legacy = 4');
		reader.pragma(`key = "x'${t.key.toString('hex')}'"`);
		expect(() => reader.prepare('SELECT count(*) FROM sqlite_master').get()).toThrow('locked');
	} finally {
		reader.close();
		maintenance.close();
	}
	const reopened = openDatabase({ path, key: t.key });
	try {
		expect(reopened.db.select().from(user).all()).toEqual([]);
	} finally {
		reopened.close();
	}
});

it('preserves existing event attachments and reminder state when adding undated plans', () => {
	const t = createTestDb();
	cleanup = t.cleanup;
	const dir = join(t.dir, 'previous-migrations');
	mkdirSync(join(dir, 'meta'), { recursive: true });
	const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
		entries: { idx: number; tag: string }[];
	};
	journal.entries = journal.entries.filter(({ idx }) => idx < 10);
	for (const { tag } of journal.entries)
		copyFileSync(`drizzle/${tag}.sql`, join(dir, `${tag}.sql`));
	writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal));
	const path = join(t.dir, 'previous.db');
	const previous = openDatabase({ path, key: t.key, migrationsFolder: dir });
	const when = new Date('2030-03-04T12:00:00Z');
	try {
		previous.db
			.insert(user)
			.values({
				id: 'member',
				username: 'member',
				displayName: 'Member',
				passwordHash: 'test'
			})
			.run();
		previous.db
			.insert(event)
			.values({
				id: 'dated',
				kind: 'plan',
				title: 'Dated plan',
				dateMode: 'date',
				precision: 'day',
				startDate: '2030-03-04',
				sortDate: '2030-03-04',
				createdBy: 'member',
				updatedAt: when
			})
			.run();
		previous.db
			.insert(memory)
			.values({
				id: 'photo',
				eventId: 'dated',
				originalName: 'synthetic.jpg',
				caption: '',
				altText: '',
				sortDate: '2030-03-04',
				createdBy: 'member'
			})
			.run();
		previous.db.insert(eventReminder).values({ eventId: 'dated', minutes: 0 }).run();
		previous.db
			.insert(reminderDelivery)
			.values({
				eventId: 'dated',
				userId: 'member',
				occurrence: '2030-03-04',
				minutes: 0,
				dueAt: when,
				nextAttemptAt: when,
				status: 'sent'
			})
			.run();
	} finally {
		previous.close();
	}
	const upgraded = openDatabase({ path, key: t.key });
	try {
		expect(upgraded.db.select().from(event).all()).toMatchObject([
			{ id: 'dated', createdBy: 'member', sortDate: '2030-03-04' }
		]);
		expect(upgraded.db.select().from(memory).all()).toMatchObject([
			{ id: 'photo', eventId: 'dated' }
		]);
		expect(upgraded.db.select().from(eventReminder).all()).toMatchObject([
			{ eventId: 'dated', minutes: 0 }
		]);
		expect(upgraded.db.select().from(reminderDelivery).all()).toMatchObject([
			{ eventId: 'dated', status: 'sent' }
		]);
		expect(() =>
			upgraded.db.insert(eventReminder).values({ eventId: 'unknown', minutes: 0 }).run()
		).toThrow();
		expect(() => upgraded.db.update(event).set({ dateMode: 'undated' }).run()).toThrow();
	} finally {
		upgraded.close();
	}
});
