import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
// `better-sqlite3` is an npm alias for `better-sqlite3-multiple-ciphers` (see package.json), so the
// Drizzle driver and this module share the SQLCipher-enabled build.
import Database, { type RunResult } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema.ts';

/** The database or an open transaction; services accept either, so they compose. */
export type Db = BaseSQLiteDatabase<'sync', RunResult, typeof schema>;

export const DATABASE_FILE = 'herbarium.db';

export class DatabaseKeyError extends Error {
	constructor() {
		super('The database cannot be opened with the configured master key');
		this.name = 'DatabaseKeyError';
	}
}

export interface OpenOptions {
	/** Path of the SQLite file, or `:memory:`. */
	path: string;
	/** 32-byte raw SQLCipher key (derived from the master key, never the master key itself). */
	key: Buffer;
	/** Folder with the drizzle-kit migrations. Defaults to `./drizzle`. */
	migrationsFolder?: string;
}

/**
 * Opens the encrypted database, verifies the key and applies pending migrations.
 *
 * The cipher is SQLCipher v4, so the file stays readable with the stock `sqlcipher` tool given the
 * derived key (see docs/key-management.md).
 */
export function openDatabase({ path, key, migrationsFolder }: OpenOptions): {
	db: Db;
	close: () => void;
} {
	if (key.length !== 32) throw new Error('Expected a 32-byte database key');

	const sqlite = new Database(path);
	try {
		sqlite.pragma(`cipher = 'sqlcipher'`);
		// Plain SQLite silently ignores cipher pragmas; refuse to run without encryption.
		if (sqlite.pragma('cipher', { simple: true }) !== 'sqlcipher') {
			throw new Error('SQLite was built without encryption support');
		}
		sqlite.pragma('legacy = 4');
		// A raw key, not a passphrase: SQLCipher skips its own KDF. The value is hex we produce
		// ourselves, never user input, so building the pragma string is safe here.
		sqlite.pragma(`key = "x'${key.toString('hex')}'"`);
		try {
			sqlite.prepare('SELECT count(*) FROM sqlite_master').get();
		} catch {
			throw new DatabaseKeyError();
		}
		sqlite.pragma('journal_mode = WAL');
		sqlite.pragma('foreign_keys = ON');
		sqlite.pragma('busy_timeout = 5000');
		sqlite.pragma('secure_delete = ON');

		const db = drizzle({ client: sqlite, schema });
		migrate(db, { migrationsFolder: migrationsFolder ?? resolve('drizzle') });
		return { db, close: () => sqlite.close() };
	} catch (error) {
		sqlite.close();
		throw error;
	}
}

let current: Db | undefined;

/** Opens the database in the data directory once at server start. */
export function initDatabase(dataDir: string, key: Buffer): Db {
	if (!existsSync(dataDir)) {
		mkdirSync(dataDir, { recursive: true, mode: 0o700 });
	}
	const path = join(dataDir, DATABASE_FILE);
	const isNew = !existsSync(path);
	current = openDatabase({ path, key }).db;
	if (isNew) chmodSync(path, 0o600);
	return current;
}

export function getDb(): Db {
	if (!current) throw new Error('Database accessed before initDatabase() was called');
	return current;
}

export { schema };
