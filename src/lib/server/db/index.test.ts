import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../testing';
import { DatabaseKeyError, openDatabase } from './index';
import {
	event,
	eventPlace,
	eventReminder,
	memory,
	reminderDelivery,
	savedPlace,
	user
} from './schema';

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

function previousMigrations(root: string, firstExcluded: number) {
	const dir = join(root, 'previous-migrations');
	mkdirSync(join(dir, 'meta'), { recursive: true });
	const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as {
		entries: { idx: number; tag: string }[];
	};
	journal.entries = journal.entries.filter(({ idx }) => idx < firstExcluded);
	for (const { tag } of journal.entries)
		copyFileSync(`drizzle/${tag}.sql`, join(dir, `${tag}.sql`));
	writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal));
	return dir;
}

it('preserves existing event attachments and reminder state when adding undated plans', () => {
	const t = createTestDb();
	cleanup = t.cleanup;
	const dir = previousMigrations(t.dir, 10);
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
		previous.db.run(sql`
			INSERT INTO event (id, kind, title, date_mode, precision, start_date, sort_date, created_by, updated_at)
			VALUES ('dated', 'plan', 'Dated plan', 'date', 'day', '2030-03-04', '2030-03-04', 'member', ${when.getTime()})
		`);
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

it('links only unique exact legacy matches to saved places during migration', () => {
	const t = createTestDb();
	cleanup = t.cleanup;
	const migrationsFolder = previousMigrations(t.dir, 13);
	const path = join(t.dir, 'legacy-locations.db');
	const previous = openDatabase({ path, key: t.key, migrationsFolder });
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
			.insert(savedPlace)
			.values([
				{ id: 'known', place: 'Garden', lat: 0, lon: 0, createdBy: 'member' },
				{ id: 'first', place: 'Park', lat: 10, lon: 20, createdBy: 'member' },
				{ id: 'second', place: 'Park', lat: 10, lon: 20, createdBy: 'member' }
			])
			.run();
		previous.db.run(sql`
			INSERT INTO event (id, kind, title, place, lat, lon, date_mode, precision, created_by, updated_at)
			VALUES ('idea', 'plan', 'A plan', 'Garden', 0, 0, 'undated', 'day', 'member', 0)
		`);
		previous.db.run(sql`
			INSERT INTO event_place (event_id, position, place, lat, lon)
			VALUES ('idea', 0, 'Garden', 0, 0), ('idea', 1, 'Park', 10, 20), ('idea', 2, 'Garden', 1, 0)
		`);
	} finally {
		previous.close();
	}
	const upgraded = openDatabase({ path, key: t.key });
	try {
		expect(upgraded.db.select().from(event).get()).toMatchObject({
			savedPlaceId: 'known',
			lat: 0,
			lon: 0
		});
		expect(upgraded.db.select().from(eventPlace).orderBy(eventPlace.position).all()).toMatchObject([
			{ savedPlaceId: 'known' },
			{ savedPlaceId: null },
			{ savedPlaceId: null }
		]);
	} finally {
		upgraded.close();
	}
});
