import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { generateDataKey } from '#lib/server/crypto/keys.ts';
import type { Db } from '#lib/server/db/index.ts';
import { mediaIdentity } from '#lib/server/db/schema.ts';

export function existingMediaFingerprintKey(db: Db) {
	return db
		.select({ key: mediaIdentity.key })
		.from(mediaIdentity)
		.where(eq(mediaIdentity.id, 1))
		.get();
}

export function mediaFingerprintKey(db: Db): Buffer {
	const row = existingMediaFingerprintKey(db);
	if (row) return row.key;
	return db.transaction((tx) => {
		tx.insert(mediaIdentity).values({ id: 1, key: generateDataKey() }).onConflictDoNothing().run();
		return tx
			.select({ key: mediaIdentity.key })
			.from(mediaIdentity)
			.where(eq(mediaIdentity.id, 1))
			.get()!.key;
	});
}

export function newMediaFingerprint(key: Buffer) {
	return createHmac('sha256', key).update('herbarium/media/original/v1\0');
}

export function importFingerprint(key: Buffer, importId: string, fingerprint: string) {
	return createHmac('sha256', key)
		.update('herbarium/media/import-receipt/v1\0')
		.update(importId)
		.update(fingerprint)
		.digest('hex');
}
