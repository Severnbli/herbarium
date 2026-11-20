import { Readable } from 'node:stream';
import { crc32 } from 'node:zlib';
import { eq } from 'drizzle-orm';
import { openPromise, type Entry, type ZipFile } from 'yauzl';
import { audit } from '#lib/server/audit.ts';
import { hashPassword } from '#lib/server/auth/password.ts';
import type { Config } from '#lib/server/config.ts';
import { generateId, generateToken } from '#lib/server/crypto/tokens.ts';
import type { Db } from '#lib/server/db/index.ts';
import {
	album,
	albumMemory,
	auditLog,
	event,
	eventReminder,
	invite,
	keyRotation,
	mediaFile,
	memory,
	user
} from '#lib/server/db/schema.ts';
import { cleanOrphanMedia } from '#lib/server/media/cleanup.ts';
import { processMedia } from '#lib/server/media/process.ts';
import { removeMediaFile } from '#lib/server/media/store.ts';
import {
	archiveManifest,
	type ArchiveManifest,
	MANIFEST_PATH,
	MAX_ARCHIVE_ROWS,
	MAX_MANIFEST_BYTES,
	originalPath
} from './manifest.ts';

export class RestoreError extends Error {}

function checkFresh(db: Db) {
	const [owner, extra] = db
		.select({ id: user.id, role: user.role, deactivatedAt: user.deactivatedAt })
		.from(user)
		.limit(2)
		.all();
	if (
		!owner ||
		extra ||
		owner.role !== 'owner' ||
		owner.deactivatedAt ||
		db.select({ id: keyRotation.id }).from(keyRotation).limit(1).get() ||
		db
			.select({ id: auditLog.id })
			.from(auditLog)
			.where(eq(auditLog.event, 'archive_restored'))
			.get() ||
		db.select({ id: event.id }).from(event).limit(1).get() ||
		db.select({ id: memory.id }).from(memory).limit(1).get() ||
		db.select({ id: album.id }).from(album).limit(1).get() ||
		db.select({ id: invite.id }).from(invite).limit(1).get()
	) {
		throw new RestoreError(
			'Set up a fresh instance with one owner, then stop it before restoring.'
		);
	}
	return owner.id;
}

async function* checkedBytes(zip: ZipFile, entry: Entry) {
	const stream = await zip.openReadStreamPromise(entry);
	let checksum = 0;
	for await (const chunk of stream) {
		const bytes = chunk as Buffer;
		checksum = crc32(bytes, checksum);
		yield bytes;
	}
	if (checksum !== entry.crc32) throw new RestoreError('The archive failed its checksum.');
}

function indexRows<T extends { id: string }>(rows: T[]) {
	const index = new Map(rows.map((row) => [row.id, row]));
	if (index.size !== rows.length) throw new RestoreError('The archive contains duplicate records.');
	return index;
}

function validateReferences(manifest: ArchiveManifest) {
	const authors = indexRows(manifest.authors);
	const events = indexRows(manifest.events);
	const memories = indexRows(manifest.memories);
	const albums = indexRows(manifest.albums);
	const links = new Set(manifest.albumMemories.map((row) => `${row.albumId}:${row.memoryId}`));
	const reminders = new Set(manifest.reminders.map((row) => `${row.eventId}:${row.minutes}`));
	if (
		[...manifest.events, ...manifest.memories, ...manifest.albums].some(
			(row) => !authors.has(row.createdBy)
		) ||
		manifest.memories.some((row) => row.eventId !== null && !events.has(row.eventId)) ||
		links.size !== manifest.albumMemories.length ||
		manifest.albumMemories.some((row) => !albums.has(row.albumId) || !memories.has(row.memoryId)) ||
		reminders.size !== manifest.reminders.length ||
		manifest.reminders.some((row) => !events.has(row.eventId))
	) {
		throw new RestoreError('The archive contains invalid relationships.');
	}
}

async function readManifest(zip: ZipFile, entry: Entry) {
	if (entry.fileName !== MANIFEST_PATH || entry.uncompressedSize > MAX_MANIFEST_BYTES) {
		throw new RestoreError('The archive has an invalid manifest.');
	}
	const chunks: Buffer[] = [];
	for await (const chunk of checkedBytes(zip, entry)) chunks.push(chunk);
	const result = archiveManifest.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
	if (!result.success)
		throw new RestoreError('The archive has an unsupported or invalid manifest.');
	validateReferences(result.data);
	return result.data;
}

export async function restoreArchive(
	db: Db,
	config: Config,
	wrappingKey: Buffer,
	path: string,
	signal: AbortSignal
) {
	const owner = checkFresh(db);
	cleanOrphanMedia(db, config.dataDir);
	const zip = await openPromise(path, { autoClose: false, strictFileNames: true });
	const staged: string[] = [];
	try {
		if (zip.entryCount < 1 || zip.entryCount > MAX_ARCHIVE_ROWS + 1) {
			throw new RestoreError('The archive has an invalid number of files.');
		}
		const entries = zip.eachEntry();
		const first = await entries.next();
		if (first.done) throw new RestoreError('The archive is empty.');
		const manifest = await readManifest(zip, first.value);
		// Cleaning can add a small container overhead to files accepted at the upload limit.
		const mediaConfig = {
			...config,
			limits: { ...config.limits, maxFileBytes: config.limits.maxFileBytes + 1024 * 1024 }
		};
		const expected = new Map(manifest.memories.map((row) => [originalPath(row), row]));
		if (zip.entryCount !== expected.size + 1)
			throw new RestoreError('The archive has missing or extra files.');
		const assets: (typeof mediaFile.$inferInsert)[] = [];
		const memories: (typeof memory.$inferInsert)[] = [];
		for await (const entry of entries) {
			signal.throwIfAborted();
			const row = expected.get(entry.fileName);
			if (!row || entry.uncompressedSize !== row.original.size) {
				throw new RestoreError('An archived original is missing or invalid.');
			}
			if (entry.uncompressedSize > mediaConfig.limits.maxFileBytes) {
				throw new RestoreError('An original exceeds MAX_FILE_BYTES. Increase the limit and retry.');
			}
			expected.delete(entry.fileName);
			const { original, ...metadata } = row;
			memories.push(metadata);
			// Read by the expected member name. The ZIP is never extracted to disk.
			const source = Readable.from(checkedBytes(zip, entry), { objectMode: false });
			const processed = await processMedia(source, mediaConfig, wrappingKey, signal, staged);
			if (processed.metadata.contentType !== original.contentType) {
				throw new RestoreError('An archived original has an unexpected media type.');
			}
			assets.push(...processed.variants.map((file) => ({ ...file, memoryId: row.id })));
		}
		if (expected.size) throw new RestoreError('The archive has missing originals.');

		const passwordHash = manifest.authors.length ? await hashPassword(generateToken()) : '';
		signal.throwIfAborted();
		db.transaction((tx) => {
			if (checkFresh(tx) !== owner) throw new RestoreError('The restore destination changed.');
			if (manifest.authors.some((row) => row.id === owner)) {
				throw new RestoreError('An archive author conflicts with the destination owner.');
			}
			const now = new Date();
			for (const row of manifest.authors) {
				tx.insert(user)
					.values({
						...row,
						username: `archive-${generateId().toLowerCase()}`,
						passwordHash,
						deactivatedAt: now
					})
					.run();
			}
			for (const row of manifest.events) tx.insert(event).values(row).run();
			for (const row of memories) tx.insert(memory).values(row).run();
			for (const row of assets) tx.insert(mediaFile).values(row).run();
			for (const row of manifest.albums) tx.insert(album).values(row).run();
			for (const row of manifest.albumMemories) tx.insert(albumMemory).values(row).run();
			for (const row of manifest.reminders) tx.insert(eventReminder).values(row).run();
			audit(tx, 'archive_restored', { actorId: owner });
		});
		staged.length = 0;
	} finally {
		zip.close();
		await Promise.allSettled(staged.map((id) => removeMediaFile(config.dataDir, id)));
	}
}
