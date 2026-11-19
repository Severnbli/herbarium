import { createHmac, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { eq, gt } from 'drizzle-orm';
import { audit } from '#lib/server/audit.ts';
import { openSecret, sealSecret } from '#lib/server/auth/totp.ts';
import { DATABASE_FILE, DatabaseKeyError, openDatabase, type Db } from '#lib/server/db/index.ts';
import { keyRotation, mediaFile, user } from '#lib/server/db/schema.ts';
import { deriveKeys, type Keys, unwrapDataKey, wrapDataKey } from './keys.ts';

export class RotationError extends Error {}

const rotationId = 1;
const pendingRotation = (db: Db) =>
	db.select().from(keyRotation).where(eq(keyRotation.id, rotationId)).get();

export function rotationFingerprint(key: Buffer) {
	return createHmac('sha256', key).update('herbarium/master-key-rotation/v1').digest();
}

function verifyTarget(expected: Buffer, target: Buffer) {
	if (expected.length !== target.length || !timingSafeEqual(expected, target)) {
		throw new RotationError(
			'Herbarium has an unfinished key rotation. Restart with its intended new and previous keys.'
		);
	}
}

export function stageRotation(db: Db, previous: Keys, next: Keys, target: Buffer) {
	db.transaction(
		(tx) => {
			const pending = pendingRotation(tx);
			if (pending) {
				verifyTarget(target, pending.target);
				return;
			}
			let after = '';
			for (;;) {
				const files = tx
					.select({ id: mediaFile.id, wrappedKey: mediaFile.wrappedKey })
					.from(mediaFile)
					.where(gt(mediaFile.id, after))
					.orderBy(mediaFile.id)
					.limit(500)
					.all();
				if (!files.length) break;
				for (const file of files) {
					const context = `media:${file.id}`;
					const raw = unwrapDataKey(previous.keyWrap, file.wrappedKey, context);
					try {
						const wrappedKey = wrapDataKey(next.keyWrap, raw, context);
						tx.update(mediaFile).set({ wrappedKey }).where(eq(mediaFile.id, file.id)).run();
					} finally {
						raw.fill(0);
					}
					after = file.id;
				}
			}
			const members = tx
				.select({
					id: user.id,
					totpSecret: user.totpSecret,
					totpPendingSecret: user.totpPendingSecret
				})
				.from(user)
				.all();
			for (const member of members) {
				const reseal = (secret: Buffer | null) =>
					secret &&
					sealSecret(next.field, member.id, openSecret(previous.field, member.id, secret));
				if (member.totpSecret || member.totpPendingSecret) {
					tx.update(user)
						.set({
							totpSecret: reseal(member.totpSecret),
							totpPendingSecret: reseal(member.totpPendingSecret)
						})
						.where(eq(user.id, member.id))
						.run();
				}
			}
			tx.insert(keyRotation).values({ id: rotationId, target }).run();
		},
		{ behavior: 'immediate' }
	);
}

export function openInstanceDatabase(
	dataDir: string,
	masterKey: Buffer,
	masterKeyPrevious?: Buffer
) {
	const path = join(dataDir, DATABASE_FILE);
	const existing = existsSync(path);
	if (!existing && masterKeyPrevious) {
		throw new RotationError('Key rotation requires an existing Herbarium database.');
	}
	mkdirSync(dataDir, { recursive: true, mode: 0o700 });
	const next = deriveKeys(masterKey);
	const target = rotationFingerprint(masterKey);
	const openCurrent = () =>
		openDatabase({ path, key: next.database, fileMustExist: !!masterKeyPrevious });
	let opened: ReturnType<typeof openCurrent>;
	try {
		opened = openCurrent();
	} catch (cause) {
		if (!(cause instanceof DatabaseKeyError) || !masterKeyPrevious) throw cause;
		const previous = deriveKeys(masterKeyPrevious);
		const old = openDatabase({ path, key: previous.database, fileMustExist: true, forRekey: true });
		try {
			stageRotation(old.db, previous, next, target);
			old.rekey(next.database);
		} catch (error) {
			if (error instanceof RotationError) throw error;
			throw new RotationError(
				'Herbarium could not rotate the master key. Keep both keys and check the stopped volume.'
			);
		} finally {
			old.close();
		}
		// Verify a new connection can read the database before completing the rotation.
		opened = openCurrent();
	}

	try {
		if (!existing) chmodSync(path, 0o600);
		const rotated = opened.db.transaction(
			(tx) => {
				const pending = pendingRotation(tx);
				if (!pending) return false;
				verifyTarget(target, pending.target);
				audit(tx, 'master_key_rotated');
				tx.delete(keyRotation).where(eq(keyRotation.id, rotationId)).run();
				return true;
			},
			{ behavior: 'immediate' }
		);
		return { ...opened, keys: next, rotated };
	} catch (cause) {
		opened.close();
		throw cause;
	}
}
