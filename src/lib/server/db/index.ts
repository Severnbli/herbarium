import { resolve } from 'node:path';
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
	fileMustExist?: boolean;
	forRekey?: boolean;
}

/**
 * Opens the encrypted database, verifies the key and applies pending migrations.
 *
 * The cipher is SQLCipher v4, so the file stays readable with the stock `sqlcipher` tool given the
 * derived key (see docs/key-management.md).
 */
export function openDatabase({
	path,
	key,
	migrationsFolder,
	fileMustExist = false,
	forRekey = false
}: OpenOptions) {
	if (key.length !== 32) throw new Error('Expected a 32-byte database key');

	const sqlite = new Database(path, { fileMustExist });
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
		} catch (cause) {
			if ((cause as { code?: string }).code === 'SQLITE_NOTADB') throw new DatabaseKeyError();
			throw cause;
		}
		sqlite.pragma('busy_timeout = 5000');
		if (forRekey) {
			if (sqlite.pragma('journal_mode = DELETE', { simple: true }) !== 'delete') {
				throw new Error('Could not enable the rotation rollback journal');
			}
			sqlite.pragma('locking_mode = EXCLUSIVE');
			sqlite.pragma('synchronous = EXTRA');
		} else {
			sqlite.pragma('journal_mode = WAL');
		}
		sqlite.pragma('foreign_keys = ON');
		sqlite.pragma('secure_delete = ON');

		const db = drizzle({ client: sqlite, schema });
		migrate(db, { migrationsFolder: migrationsFolder ?? resolve('drizzle') });
		return {
			db,
			close: () => sqlite.close(),
			rekey(newKey: Buffer) {
				if (!forRekey || newKey.length !== 32) throw new Error('Invalid database rekey operation');
				const result = sqlite.pragma(`rekey = "x'${newKey.toString('hex')}'"`, { simple: true });
				if (result !== 'ok') throw new Error('Database rekey failed');
			}
		};
	} catch (error) {
		sqlite.close();
		throw error;
	}
}

export { schema };
