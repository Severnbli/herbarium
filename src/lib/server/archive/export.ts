import { Readable, addAbortSignal } from 'node:stream';
import { eq } from 'drizzle-orm';
import { ZipFile } from 'yazl';
import { audit } from '#lib/server/audit.ts';
import { unwrapDataKey } from '#lib/server/crypto/keys.ts';
import { type Db } from '#lib/server/db/index.ts';
import {
	album,
	albumMemory,
	event,
	eventPlace,
	savedPlace,
	eventReminder,
	mediaFile,
	memory,
	user
} from '#lib/server/db/schema.ts';
import { openMedia } from '#lib/server/media/format.ts';
import { holdMediaFiles, openMediaFile } from '#lib/server/media/store.ts';
import { MANIFEST_PATH, MAX_ARCHIVE_ROWS, MAX_MANIFEST_BYTES, originalPath } from './manifest.ts';

let exporting = false;

function* queryRows<T>(query: {
	limit: (size: number) => { offset: (start: number) => { all: () => T[] } };
}) {
	const batchSize = 250;
	for (let offset = 0; ; offset += batchSize) {
		const rows = query.limit(batchSize).offset(offset).all();
		yield* rows;
		if (rows.length < batchSize) return;
	}
}

function snapshot(db: Db) {
	return db.transaction((tx) => {
		const assets = new Map<string, typeof mediaFile.$inferSelect>();
		for (const asset of queryRows(
			tx.select().from(mediaFile).where(eq(mediaFile.variant, 'original')).orderBy(mediaFile.id)
		)) {
			if (assets.size >= MAX_ARCHIVE_ROWS) throw new Error('Too many archived originals');
			assets.set(asset.memoryId, asset);
		}

		const originals: { path: string; asset: typeof mediaFile.$inferSelect }[] = [];
		function* memoryRows() {
			for (const row of queryRows(tx.select().from(memory).orderBy(memory.id))) {
				const asset = assets.get(row.id);
				if (!asset) throw new Error('Original unavailable');
				const archived = { ...row, original: { contentType: asset.contentType, size: asset.size } };
				originals.push({ path: originalPath(archived), asset });
				yield archived;
			}
		}

		const collections = {
			authors: queryRows(
				tx
					.select({ id: user.id, displayName: user.displayName, createdAt: user.createdAt })
					.from(user)
					.orderBy(user.id)
			),
			savedPlaces: queryRows(tx.select().from(savedPlace).orderBy(savedPlace.id)),
			eventPlaces: queryRows(
				tx.select().from(eventPlace).orderBy(eventPlace.eventId, eventPlace.position)
			),
			events: queryRows(tx.select().from(event).orderBy(event.id)),
			memories: memoryRows(),
			albums: queryRows(tx.select().from(album).orderBy(album.id)),
			albumMemories: queryRows(
				tx.select().from(albumMemory).orderBy(albumMemory.albumId, albumMemory.memoryId)
			),
			reminders: queryRows(
				tx.select().from(eventReminder).orderBy(eventReminder.eventId, eventReminder.minutes)
			)
		};
		const chunks: string[] = [];
		let size = 0;
		function append(part: string) {
			size += Buffer.byteLength(part);
			if (size > MAX_MANIFEST_BYTES) throw new Error('Archive manifest is too large');
			chunks.push(part);
		}

		append(`{"version":3,"exportedAt":${JSON.stringify(new Date())}`);
		for (const [name, rows] of Object.entries(collections)) {
			append(`,"${name}":[`);
			let count = 0;
			for (const row of rows) {
				if (count >= MAX_ARCHIVE_ROWS) throw new Error('Too many archive records');
				append(`${count++ ? ',' : ''}${JSON.stringify(row)}`);
			}
			append(']');
		}
		append('}');
		return { json: Buffer.from(chunks.join('')), originals };
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
	const { json, originals } = snapshot(db);
	audit(db, 'export_started', { actorId, ip });
	const release = holdMediaFiles(
		dataDir,
		originals.map(({ asset }) => asset.id)
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
		for (const { path, asset } of originals) {
			zip.addReadStreamLazy(
				path,
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
