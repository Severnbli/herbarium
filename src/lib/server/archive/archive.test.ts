import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import sharp from 'sharp';
import { ZipFile } from 'yazl';
import { afterEach, expect, it } from 'vitest';
import { addUser } from '#lib/server/auth/fixtures.ts';
import { loadConfig } from '#lib/server/config.ts';
import { deriveKeys } from '#lib/server/crypto/keys.ts';
import { generateId } from '#lib/server/crypto/tokens.ts';
import { DATABASE_FILE, openDatabase } from '#lib/server/db/index.ts';
import {
	album,
	albumMemory,
	auditLog,
	event,
	savedPlace,
	eventPlace,
	eventReminder,
	mediaFile,
	memory,
	user
} from '#lib/server/db/schema.ts';
import { openMedia } from '#lib/server/media/format.ts';
import { openMediaFile, removeMediaFile, storeMediaFile } from '#lib/server/media/store.ts';
import { unwrapDataKey } from '#lib/server/crypto/keys.ts';
import { createEvent } from '#lib/server/events/events.ts';
import { emptyEventForm } from '#lib/server/events/schemas.ts';
import { createExport } from './export.ts';
import { archiveManifest, MANIFEST_PATH } from './manifest.ts';
import { restoreArchive } from './restore.ts';

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.reverse()) await cleanup();
	cleanups.length = 0;
});

async function instance() {
	const dir = await mkdtemp(join(tmpdir(), 'herbarium-archive-'));
	cleanups.push(() => rm(dir, { recursive: true, force: true }));
	const config = loadConfig(
		{
			...process.env,
			MASTER_KEY_FILE: undefined,
			MASTER_KEY: randomBytes(32).toString('hex'),
			DATA_DIR: dir
		},
		{ production: false }
	);
	const { keyWrap, database } = deriveKeys(config.masterKey);
	const path = join(dir, DATABASE_FILE);
	const { db, close } = openDatabase({ path, key: database });
	cleanups.push(close);
	return { db, keyWrap, config, path };
}

it('streams a consistent snapshot and restores content to a different encrypted volume', async () => {
	const from = await instance();
	const to = await instance();
	const author = await addUser(from.db, 'source-account', { role: 'owner' });
	const owner = await addUser(to.db, 'destination-owner', { role: 'owner' });
	const eventId = generateId();
	const savedPlaceId = generateId();
	from.db
		.insert(savedPlace)
		.values({ id: savedPlaceId, place: 'Garden', lat: 0, lon: 0, createdBy: author })
		.run();
	const albumId = generateId();
	const memoryId = generateId();
	const date = new Date('2025-10-12T12:00:00.000Z');
	from.db
		.insert(event)
		.values({
			id: eventId,
			kind: 'occasion',
			title: 'Test anniversary',
			notes: '**Test**',
			place: 'Garden',
			savedPlaceId,
			lat: 53.9,
			lon: 27.56,
			dateMode: 'date',
			precision: 'day',
			startDate: '2020-02-29',
			sortDate: '2020-02-29',
			recurrenceRule: 'FREQ=YEARLY;INTERVAL=1',
			occasionType: 'anniversary',
			createdBy: author,
			createdAt: date,
			updatedAt: date
		})
		.run();
	const undatedId = createEvent(
		from.db,
		author,
		{
			...emptyEventForm,
			kind: 'plan',
			dateMode: 'undated',
			title: 'Synthetic unscheduled plan'
		},
		date
	);
	from.db
		.insert(eventPlace)
		.values({ eventId, position: 0, place: 'Garden', lat: 10, lon: 20, savedPlaceId })
		.run();
	from.db.insert(eventReminder).values({ eventId: undatedId, minutes: 0, createdAt: date }).run();
	from.db.transaction((tx) => {
		for (let index = 0; index < 250; index++) {
			tx.insert(event)
				.values({
					id: generateId(),
					kind: 'moment',
					title: `Synthetic event ${index}`,
					dateMode: 'date',
					precision: 'day',
					startDate: '2020-02-29',
					sortDate: '2020-02-29',
					createdBy: author,
					createdAt: date,
					updatedAt: date
				})
				.run();
		}
	});
	from.db.insert(eventReminder).values({ eventId, minutes: 1440, createdAt: date }).run();
	from.db
		.insert(memory)
		.values({
			id: memoryId,
			eventId,
			originalName: 'photo.jpg',
			altText: 'A test flower',
			caption: 'Test caption',
			captureDate: '2020-02-29',
			sortDate: '2020-02-29',
			createdBy: author,
			createdAt: date
		})
		.run();
	from.db
		.insert(album)
		.values({ id: albumId, title: 'Test album', createdBy: author, createdAt: date })
		.run();
	from.db.insert(albumMemory).values({ albumId, memoryId }).run();

	const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: 'blue' } })
		.jpeg()
		.toBuffer();
	const original = await storeMediaFile(from.config.dataDir, from.keyWrap, jpeg.length, [jpeg]);
	from.db
		.insert(mediaFile)
		.values({ ...original, memoryId, variant: 'original', contentType: 'image/jpeg' })
		.run();

	const signal = new AbortController().signal;
	const stream = createExport(
		from.db,
		from.config.dataDir,
		from.keyWrap,
		author,
		'localhost',
		signal
	)!;
	expect(
		createExport(from.db, from.config.dataDir, from.keyWrap, author, 'localhost', signal)
	).toBeNull();
	from.db.delete(memory).run();
	await removeMediaFile(from.config.dataDir, original.id);
	const bytes = await buffer(Readable.fromWeb(stream as import('node:stream/web').ReadableStream));
	const archive = join(to.config.dataDir, 'export.zip');
	await writeFile(archive, bytes);
	expect(from.db.select().from(auditLog).all()).toMatchObject([
		{ event: 'export_started', actorId: author }
	]);

	const position = bytes.indexOf(jpeg);
	expect(position).toBeGreaterThan(0);
	const damaged = Buffer.from(bytes);
	damaged[position + 10] = damaged[position + 10]! ^ 1;
	await writeFile(archive, damaged);
	await expect(restoreArchive(to.db, to.config, to.keyWrap, archive, signal)).rejects.toThrow();
	expect(to.db.select().from(event).all()).toEqual([]);
	expect(await readdir(join(to.config.dataDir, 'media')).catch(() => [])).toEqual([]);

	await writeFile(archive, bytes);
	await restoreArchive(to.db, to.config, to.keyWrap, archive, signal);
	expect(to.db.select().from(event).orderBy(event.id).all()).toEqual(
		from.db.select().from(event).orderBy(event.id).all()
	);
	expect(to.db.select().from(savedPlace).all()).toEqual(from.db.select().from(savedPlace).all());
	expect(to.db.select().from(eventPlace).all()).toEqual(from.db.select().from(eventPlace).all());
	expect(to.db.select().from(albumMemory).all()).toEqual([{ albumId, memoryId }]);
	expect(to.db.select().from(eventReminder).all()).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ eventId, minutes: 1440 }),
			expect.objectContaining({ eventId: undatedId, minutes: 0 })
		])
	);
	expect(to.db.select().from(memory).all()).toMatchObject([
		{ id: memoryId, createdBy: author, captureDate: '2020-02-29' }
	]);
	expect(to.db.select().from(user).all()).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ id: owner, deactivatedAt: null }),
			expect.objectContaining({
				id: author,
				displayName: 'source-account',
				deactivatedAt: expect.any(Date)
			})
		])
	);
	const variants = to.db.select().from(mediaFile).all();
	expect(variants.map((asset) => asset.variant)).toEqual(['original', 'preview', 'thumbnail']);
	const restored = variants[0]!;
	const encrypted = await readFile(join(to.config.dataDir, 'media', restored.id));
	expect(encrypted.includes(jpeg)).toBe(false);
	const file = await openMediaFile(to.config.dataDir, restored.id);
	try {
		const key = unwrapDataKey(to.keyWrap, restored.wrappedKey, `media:${restored.id}`);
		const read = await openMedia(file, key, restored.size);
		const restoredBytes = await buffer(Readable.from(read({ start: 0, end: restored.size - 1 })));
		expect((await sharp(restoredBytes).metadata()).width).toBe(16);
	} finally {
		await file.close();
	}
	expect(to.db.select().from(auditLog).all()).toMatchObject([
		{ event: 'archive_restored', actorId: owner }
	]);
	await expect(restoreArchive(to.db, to.config, to.keyWrap, archive, signal)).rejects.toThrow(
		'fresh instance'
	);
});

it('accepts the version 1 manifest for a dated plan', () => {
	const author = generateId();
	const date = '2030-03-04T12:00:00.000Z';
	const archived = {
		id: generateId(),
		kind: 'plan',
		title: 'A dated plan',
		notes: '',
		place: '',
		lat: null,
		lon: null,
		category: 'none',
		dateMode: 'date',
		precision: 'day',
		startDate: '2030-03-04',
		sortDate: '2030-03-04',
		endDate: null,
		startsAt: null,
		endsAt: null,
		timeZone: null,
		recurrenceRule: null,
		occasionType: null,
		createdBy: author,
		createdAt: date,
		updatedAt: date
	};
	const legacy = {
		version: 1,
		exportedAt: date,
		authors: [{ id: author, displayName: 'Account', createdAt: date }],
		events: [archived],
		memories: [],
		albums: [],
		albumMemories: [],
		reminders: []
	};
	expect(archiveManifest.parse(legacy).events[0]).toMatchObject({
		id: archived.id,
		dateMode: 'date'
	});
	expect(
		archiveManifest.safeParse({
			...legacy,
			events: [{ ...archived, dateMode: 'undated', startDate: null, sortDate: null }]
		}).success
	).toBe(false);
});

it('restores version 3 places and links only unique location matches', async () => {
	const from = await instance();
	const to = await instance();
	const author = await addUser(from.db, 'author', { role: 'owner' });
	await addUser(to.db, 'owner', { role: 'owner' });
	const eventId = createEvent(from.db, author, {
		...emptyEventForm,
		title: 'Visit',
		start: '2020-02-29',
		place: 'Garden',
		lat: '0',
		lon: '0'
	});
	const unique = { id: generateId(), place: 'Garden', lat: 0, lon: 0, createdBy: author };
	const duplicate = { id: generateId(), place: 'Park', lat: 10, lon: 20, createdBy: author };
	const manifest = {
		version: 3,
		exportedAt: new Date(),
		authors: [{ id: author, displayName: 'Archive author', createdAt: new Date() }],
		savedPlaces: [unique, duplicate, { ...duplicate, id: generateId() }],
		events: [{ ...from.db.select().from(event).get(), savedPlaceId: undefined }],
		eventPlaces: [
			{ eventId, position: 0, place: 'Garden', lat: 0, lon: 0 },
			{ eventId, position: 1, place: 'Park', lat: 10, lon: 20 }
		],
		memories: [],
		albums: [],
		albumMemories: [],
		reminders: []
	};
	const zip = new ZipFile();
	zip.addBuffer(Buffer.from(JSON.stringify(manifest)), MANIFEST_PATH);
	zip.end();
	const archive = join(to.config.dataDir, 'legacy.zip');
	await writeFile(archive, await buffer(zip.outputStream));
	await restoreArchive(to.db, to.config, to.keyWrap, archive, new AbortController().signal);
	expect(to.db.select().from(event).get()).toMatchObject({ savedPlaceId: unique.id });
	expect(to.db.select().from(eventPlace).orderBy(eventPlace.position).all()).toMatchObject([
		{ savedPlaceId: unique.id },
		{ savedPlaceId: null }
	]);
});
