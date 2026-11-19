import { Readable, addAbortSignal } from 'node:stream';
import { eq, getTableColumns } from 'drizzle-orm';
import { ZipFile } from 'yazl';
import { audit } from '#lib/server/audit.ts';
import { unwrapDataKey } from '#lib/server/crypto/keys.ts';
import { type Db } from '#lib/server/db/index.ts';
import {
	album,
	albumMemory,
	event,
	eventReminder,
	mediaFile,
	memory,
	user
} from '#lib/server/db/schema.ts';
import { openMedia } from '#lib/server/media/format.ts';
import { holdMediaFiles, openMediaFile } from '#lib/server/media/store.ts';
import { MANIFEST_PATH, MAX_ARCHIVE_ROWS, MAX_MANIFEST_BYTES, originalPath } from './manifest.ts';

let exporting = false;

function snapshot(db: Db) {
	return db.transaction((tx) => {
		const originals = tx
			.select()
			.from(mediaFile)
			.where(eq(mediaFile.variant, 'original'))
			.limit(MAX_ARCHIVE_ROWS + 1)
			.all();
		const assets = new Map(originals.map((asset) => [asset.memoryId, asset]));
		const manifest = {
			version: 1,
			exportedAt: new Date(),
			authors: tx
				.select({ id: user.id, displayName: user.displayName, createdAt: user.createdAt })
				.from(user)
				.limit(MAX_ARCHIVE_ROWS + 1)
				.all(),
			events: tx
				.select()
				.from(event)
				.limit(MAX_ARCHIVE_ROWS + 1)
				.all(),
			memories: tx
				.select(getTableColumns(memory))
				.from(memory)
				.limit(MAX_ARCHIVE_ROWS + 1)
				.all()
				.map((row) => {
					const asset = assets.get(row.id);
					if (!asset) throw new Error('Original unavailable');
					return { ...row, original: { contentType: asset.contentType, size: asset.size } };
				}),
			albums: tx
				.select()
				.from(album)
				.limit(MAX_ARCHIVE_ROWS + 1)
				.all(),
			albumMemories: tx
				.select()
				.from(albumMemory)
				.limit(MAX_ARCHIVE_ROWS + 1)
				.all(),
			reminders: tx
				.select()
				.from(eventReminder)
				.limit(MAX_ARCHIVE_ROWS + 1)
				.all()
		};
		for (const rows of [
			manifest.authors,
			manifest.events,
			manifest.memories,
			manifest.albums,
			manifest.albumMemories,
			manifest.reminders
		]) {
			if (rows.length > MAX_ARCHIVE_ROWS) throw new Error('Too many archive records');
		}
		const json = Buffer.from(JSON.stringify(manifest));
		if (json.length > MAX_MANIFEST_BYTES) throw new Error('Archive manifest is too large');
		return { json, memories: manifest.memories, assets };
	});
}

async function* readOriginal(
	dataDir: string,
	wrappingKey: Buffer,
	asset: typeof mediaFile.$inferSelect,
	signal: AbortSignal
) {
	signal.throwIfAborted();
	const key = unwrapDataKey(wrappingKey, asset.wrappedKey, `media:${asset.id}`);
	try {
		const file = await openMediaFile(dataDir, asset.id);
		try {
			const read = await openMedia(file, key, asset.size);
			for await (const bytes of read({ start: 0, end: asset.size - 1 })) {
				signal.throwIfAborted();
				yield bytes;
			}
		} finally {
			await file.close();
		}
	} finally {
		key.fill(0);
	}
}

export function createExport(
	db: Db,
	dataDir: string,
	wrappingKey: Buffer,
	actorId: string,
	ip: string,
	requestSignal: AbortSignal
): ReadableStream<Uint8Array> | null {
	if (exporting) return null;
	const { json, memories, assets } = snapshot(db);
	audit(db, 'export_started', { actorId, ip });
	const release = holdMediaFiles(
		dataDir,
		[...assets.values()].map(({ id }) => id)
	);
	exporting = true;
	const zip = new ZipFile();
	const output = zip.outputStream as Readable;
	const controller = new AbortController();
	const signal = AbortSignal.any([
		controller.signal,
		requestSignal,
		AbortSignal.timeout(2 * 60 * 60_000)
	]);
	output.once('close', () => {
		controller.abort();
		exporting = false;
		release();
	});
	zip.on('error', () => output.destroy(new Error('Export stream failed')));
	addAbortSignal(signal, output);
	try {
		zip.addBuffer(json, MANIFEST_PATH, { mode: 0o600 });
		for (const row of memories) {
			const asset = assets.get(row.id)!;
			zip.addReadStreamLazy(
				originalPath(row),
				{ size: asset.size, compress: false, mode: 0o600 },
				(callback) => {
					const source = Readable.from(readOriginal(dataDir, wrappingKey, asset, signal), {
						objectMode: false,
						signal
					});
					source.on('error', () => output.destroy(new Error('Original unavailable')));
					callback(null, source);
				}
			);
		}
		zip.end();
		return Readable.toWeb(output) as ReadableStream<Uint8Array>;
	} catch (cause) {
		output.destroy();
		throw cause;
	}
}
