import { getConfig } from './config.ts';
import { deriveKeys, type Keys } from './crypto/keys.ts';
import { initDatabase, type Db } from './db/index.ts';
import { countUsers } from './auth/members.ts';
import { ensureSetupCode, removeSetupCode } from './auth/setup.ts';
import { pruneSessions } from './auth/session.ts';
import { cleanOrphanMedia } from './media/cleanup.ts';

/**
 * Server state shared by all requests: the derived keys and the database. Set up once by the
 * `init` hook after the configuration is loaded.
 */
let state: { keys: Keys; db: Db; setupDone: boolean } | undefined;

export function initApp(): void {
	// Everything the app writes (database, WAL, journal, setup code) is private to its user.
	process.umask(0o077);
	const config = getConfig();
	const keys = deriveKeys(config.masterKey);
	const db = initDatabase(config.dataDir, keys.database);
	cleanOrphanMedia(db, config.dataDir);
	const setupDone = countUsers(db) > 0;
	if (setupDone) {
		removeSetupCode(config.dataDir);
	} else {
		ensureSetupCode(config.dataDir);
		console.info(
			'Herbarium is not set up yet. Open /setup and enter the code from the file ' +
				'"setup-code" in the data directory.'
		);
	}
	pruneSessions(db);
	state = { keys, db, setupDone };
}

function current() {
	if (!state) throw new Error('Server state accessed before initApp() was called');
	return state;
}

export const db = (): Db => current().db;
export const keys = (): Keys => current().keys;

/** True once the first owner exists. It never goes back to false. */
export function isSetupDone(): boolean {
	const s = current();
	if (!s.setupDone) s.setupDone = countUsers(s.db) > 0;
	return s.setupDone;
}
