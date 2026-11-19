import { join } from 'node:path';
import { ConfigError, initConfig } from '#lib/server/config.ts';
import { deriveKeys } from '#lib/server/crypto/keys.ts';
import { DATABASE_FILE, DatabaseKeyError, openDatabase } from '#lib/server/db/index.ts';
import { RestoreError, restoreArchive } from './restore.ts';

async function main() {
	const archive = process.argv[2];
	if (!archive || process.argv.length !== 3) {
		throw new RestoreError('Usage: node build/operations/restore.js /path/to/herbarium-export.zip');
	}
	const config = initConfig(process.env, { production: true });
	const keys = deriveKeys(config.masterKey);
	process.umask(0o077);
	const { db, close } = openDatabase({
		path: join(config.dataDir, DATABASE_FILE),
		key: keys.database,
		fileMustExist: true,
		exclusive: true
	});
	const shutdown = new AbortController();
	const stop = () => shutdown.abort();
	process.once('SIGINT', stop);
	process.once('SIGTERM', stop);
	try {
		await restoreArchive(db, config, keys.keyWrap, archive, shutdown.signal);
		console.info('Herbarium finished restoring the archive.');
	} finally {
		process.removeListener('SIGINT', stop);
		process.removeListener('SIGTERM', stop);
		close();
	}
}

try {
	await main();
} catch (cause) {
	console.error(
		cause instanceof RestoreError ||
			cause instanceof ConfigError ||
			cause instanceof DatabaseKeyError
			? cause.message
			: 'Herbarium could not restore the archive. Check the archive, media tools and destination volume.'
	);
	process.exitCode = 1;
}
