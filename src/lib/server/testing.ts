import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type Db } from './db/index.ts';

/** Test helper: a fresh encrypted database in a temporary directory. Never used by the app. */
export function createTestDb(): {
	db: Db;
	dir: string;
	path: string;
	key: Buffer;
	cleanup: () => void;
} {
	const dir = mkdtempSync(join(tmpdir(), 'herbarium-test-'));
	const path = join(dir, 'test.db');
	const key = randomBytes(32);
	const { db, close } = openDatabase({ path, key });
	return {
		db,
		dir,
		path,
		key,
		cleanup: () => {
			close();
			rmSync(dir, { recursive: true, force: true });
		}
	};
}
