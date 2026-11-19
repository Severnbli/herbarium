import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { addUser } from '#lib/server/auth/fixtures.ts';
import { attemptLogin } from '#lib/server/auth/login.ts';
import { deriveKeys, unwrapDataKey } from '#lib/server/crypto/keys.ts';
import { openInstanceDatabase } from '#lib/server/crypto/rotation.ts';
import { DatabaseKeyError } from '#lib/server/db/index.ts';
import { event, mediaFile, memory } from '#lib/server/db/schema.ts';
import { openMedia } from '#lib/server/media/format.ts';
import { openMediaFile, storeMediaFile } from '#lib/server/media/store.ts';

it('restores an encrypted volume backup with its original account, coordinates and media', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'herbarium-backup-'));
	const source = join(dir, 'source');
	const destination = join(dir, 'destination');
	const archive = join(dir, 'backup.tar');
	const master = randomBytes(32);
	const { keyWrap } = deriveKeys(master);
	const sourceDb = openInstanceDatabase(source, master);
	try {
		const username = 'backup-owner';
		const password = 'synthetic backup password';
		const actorId = await addUser(sourceDb.db, username, { role: 'owner', password });
		sourceDb.db
			.insert(event)
			.values({
				id: 'event',
				title: 'Synthetic private trip',
				kind: 'moment',
				lat: 53.9,
				lon: 27.56,
				dateMode: 'date',
				precision: 'day',
				startDate: '2026-08-03',
				sortDate: '2026-08-03',
				createdBy: actorId,
				updatedAt: new Date()
			})
			.run();
		sourceDb.db
			.insert(memory)
			.values({
				id: 'memory',
				eventId: 'event',
				originalName: 'backup.jpg',
				altText: '',
				caption: '',
				sortDate: '2026-08-03',
				createdBy: actorId
			})
			.run();
		const payload = Buffer.from('test encrypted original');
		const asset = await storeMediaFile(source, keyWrap, payload.length, [payload]);
		sourceDb.db
			.insert(mediaFile)
			.values({ ...asset, memoryId: 'memory', variant: 'original', contentType: 'image/jpeg' })
			.run();
		sourceDb.close();

		execFileSync('tar', ['-cpf', archive, '-C', source, '.']);
		await mkdir(destination, { mode: 0o700 });
		execFileSync('tar', ['-xpf', archive, '-C', destination]);
		const archiveBytes = await readFile(archive);
		expect(archiveBytes.includes(payload)).toBe(false);
		expect(archiveBytes.includes('Synthetic private trip')).toBe(false);
		expect(() => openInstanceDatabase(destination, randomBytes(32))).toThrow(DatabaseKeyError);
		const restore = openInstanceDatabase(destination, master);
		try {
			expect(await attemptLogin(restore.db, { username, password, ip: 'localhost' })).toMatchObject(
				{ ok: true, userId: actorId }
			);
			expect(restore.db.select().from(event).get()).toMatchObject({ lat: 53.9, lon: 27.56 });
			const row = restore.db.select().from(mediaFile).get()!;
			const file = await openMediaFile(destination, row.id);
			try {
				const key = unwrapDataKey(keyWrap, row.wrappedKey, `media:${row.id}`);
				const read = await openMedia(file, key, row.size);
				const chunks = [];
				for await (const bytes of read({ start: 0, end: row.size - 1 })) chunks.push(bytes);
				expect(Buffer.concat(chunks)).toEqual(payload);
			} finally {
				await file.close();
			}
		} finally {
			restore.close();
		}
	} finally {
		sourceDb.close();
		await rm(dir, { recursive: true, force: true });
	}
});
