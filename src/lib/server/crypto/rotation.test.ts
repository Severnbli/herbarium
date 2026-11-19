import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { addUser } from '#lib/server/auth/fixtures.ts';
import { beginTotpSetup, sealSecret, openSecret } from '#lib/server/auth/totp.ts';
import { DATABASE_FILE, DatabaseKeyError, openDatabase } from '#lib/server/db/index.ts';
import { auditLog, keyRotation, mediaFile, memory, user } from '#lib/server/db/schema.ts';
import { storeMediaFile } from '#lib/server/media/store.ts';
import { deriveKeys, unwrapDataKey } from './keys.ts';
import {
	openInstanceDatabase,
	RotationError,
	rotationFingerprint,
	stageRotation
} from './rotation.ts';

it.each(['before staging', 'after staging', 'after rekeying'] as const)(
	'rotates and recovers when the server starts %s',
	async (phase) => {
		const dir = await mkdtemp(join(tmpdir(), 'herbarium-rotation-'));
		const oldMaster = randomBytes(32);
		const newMaster = randomBytes(32);
		const previous = deriveKeys(oldMaster);
		const next = deriveKeys(newMaster);
		const path = join(dir, DATABASE_FILE);
		let opened = openInstanceDatabase(dir, oldMaster);
		try {
			const actor = await addUser(opened.db, 'rotation-test', { role: 'owner' });
			const secret = 'JBSWY3DPEHPK3PXP';
			opened.db
				.update(user)
				.set({ totpSecret: sealSecret(previous.field, actor, secret) })
				.run();
			const pending = beginTotpSetup(opened.db, previous.field, actor, 'rotation-test').secret;
			opened.db
				.insert(memory)
				.values({
					id: 'memory',
					originalName: 'x.jpg',
					altText: '',
					caption: '',
					sortDate: '2025-01-02',
					createdBy: actor
				})
				.run();
			const original = Buffer.from('synthetic media payload');
			const asset = await storeMediaFile(dir, previous.keyWrap, original.length, [original]);
			const context = `media:${asset.id}`;
			const currentDataKey = unwrapDataKey(previous.keyWrap, asset.wrappedKey, context);
			opened.db
				.insert(mediaFile)
				.values({ ...asset, memoryId: 'memory', variant: 'original', contentType: 'image/jpeg' })
				.run();
			const assetPath = join(dir, 'media', asset.id);
			const ciphertext = await readFile(assetPath);
			opened.close();

			if (phase !== 'before staging') {
				const before = openDatabase({ path, key: previous.database, exclusive: true });
				try {
					stageRotation(before.db, previous, next, rotationFingerprint(newMaster));
					if (phase === 'after rekeying') before.rekey(next.database);
				} finally {
					before.close();
				}
				if (phase === 'after staging') {
					expect(() => openInstanceDatabase(dir, oldMaster)).toThrow(RotationError);
					expect(() => openInstanceDatabase(dir, randomBytes(32), oldMaster)).toThrow(
						RotationError
					);
				}
			}

			opened = openInstanceDatabase(
				dir,
				newMaster,
				phase === 'after rekeying' ? undefined : oldMaster
			);
			expect(opened.rotated).toBe(true);
			const row = opened.db.select().from(user).get()!;
			expect(openSecret(next.field, actor, row.totpSecret!)).toBe(secret);
			expect(openSecret(next.field, actor, row.totpPendingSecret!)).toBe(pending);
			expect(() => openSecret(previous.field, actor, row.totpSecret!)).toThrow();
			const wrapped = opened.db.select().from(mediaFile).get()!.wrappedKey;
			expect(unwrapDataKey(next.keyWrap, wrapped, context)).toEqual(currentDataKey);
			expect(() => unwrapDataKey(previous.keyWrap, wrapped, context)).toThrow();
			expect(await readFile(assetPath)).toEqual(ciphertext);
			expect(opened.db.select().from(keyRotation).all()).toEqual([]);
			opened.close();

			expect(() => openInstanceDatabase(dir, oldMaster)).toThrow(DatabaseKeyError);
			opened = openInstanceDatabase(dir, newMaster, oldMaster);
			expect(opened.rotated).toBe(false);
			expect(opened.db.select().from(auditLog).all()).toMatchObject([
				{ event: 'master_key_rotated' }
			]);
		} finally {
			opened.close();
			await rm(dir, { recursive: true, force: true });
		}
	}
);
