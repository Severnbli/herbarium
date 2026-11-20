import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addUser } from '#lib/server/auth/fixtures.ts';
import { loadConfig } from '#lib/server/config.ts';
import { deriveKeys } from '#lib/server/crypto/keys.ts';
import { generateId } from '#lib/server/crypto/tokens.ts';
import { event, mediaFile, memory } from '#lib/server/db/schema.ts';
import { createTestDb } from '#lib/server/testing.ts';
import { cleanOrphanMedia } from './cleanup.ts';
import { acceptCoordinates, offerCoordinates } from './coordinates.ts';
import { mediaResponse } from './response.ts';
import { storeMediaFile } from './store.ts';
import { uploadMemory } from './upload.ts';

const runTool = promisify(execFile);
const toolOptions = { timeout: 15_000 };
const origin = 'https://herbarium.example';
const marker = 'Synthetic private location';
const date = '2020-02-03';
let test: ReturnType<typeof createTestDb>;
let actor: string;
let eventId: string;
let instance: Parameters<typeof uploadMemory>[1];

beforeEach(async () => {
	test = createTestDb();
	actor = await addUser(test.db, 'synthetic');
	eventId = generateId();
	test.db
		.insert(event)
		.values({
			id: eventId,
			createdBy: actor,
			title: 'Synthetic event',
			kind: 'moment',
			dateMode: 'date',
			precision: 'day',
			startDate: date,
			sortDate: date,
			updatedAt: new Date()
		})
		.run();
	instance = {
		db: test.db,
		wrappingKey: deriveKeys(test.key).keyWrap,
		config: loadConfig(
			{
				MASTER_KEY: test.key.toString('base64'),
				DATA_DIR: test.dir,
				PATH: process.env.PATH,
				PERL5LIB: process.env.PERL5LIB
			},
			{ production: false }
		)
	};
});

afterEach(() => {
	test.cleanup();
});

async function upload(
	bytes: Buffer | string,
	name: string,
	options?: { extra?: boolean; length?: string }
) {
	const body = new FormData();
	body.append('altText', 'A synthetic swatch');
	body.append('caption', 'Test caption');
	body.append(
		'file',
		new Blob([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], { type: 'text/html' }),
		name
	);
	if (options?.extra) body.append('unexpected', 'field');
	const encoded = new Response(body);
	const request = new Request(`${origin}/memories/new`, {
		method: 'POST',
		body: await encoded.arrayBuffer(),
		headers: encoded.headers
	});
	if (options?.length) request.headers.set('content-length', options.length);
	return uploadMemory(request, instance, actor, eventId);
}

async function download(memoryId: string, variant: typeof mediaFile.$inferSelect.variant) {
	const asset = test.db
		.select()
		.from(mediaFile)
		.where(eq(mediaFile.memoryId, memoryId))
		.all()
		.find((file) => file.variant === variant)!;
	const response = await mediaResponse(
		new Request(`${origin}/media/${memoryId}/${variant}`),
		test.dir,
		instance.wrappingKey,
		{ ...asset, originalName: 'synthetic' },
		variant === 'original'
	);
	expect(response.status).toBe(200);
	expect(response.headers.get('content-type')).toBe(asset.contentType);
	const path = join(test.dir, `${variant}-${asset.id}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	writeFileSync(path, bytes);
	expect(readFileSync(join(test.dir, 'media', asset.id)).includes(bytes)).toBe(false);
	return { path, bytes };
}

async function tag(path: string) {
	await runTool(
		'exiftool',
		[
			'-overwrite_original',
			'-GPSLatitude=12.34',
			'-GPSLatitudeRef=N',
			'-GPSLongitude=56.78',
			'-GPSLongitudeRef=E',
			`-XMP-iptcCore:Location=${marker}`,
			'-DateTimeOriginal=2020:02:03 12:34:56',
			'-Orientation#=6',
			path
		],
		toolOptions
	);
}

async function metadata(path: string): Promise<string> {
	return (
		await runTool(
			'exiftool',
			[
				'-a',
				'-ee',
				'-G1',
				'-s',
				'-GPS:all',
				'-XMP:all',
				'-Keys:all',
				'-UserData:all',
				'-DateTimeOriginal',
				'-Orientation',
				'-GPSCoordinates',
				path
			],
			toolOptions
		)
	).stdout;
}

async function streamHash(path: string, videoFilter: string[] = []): Promise<string> {
	return (
		await runTool(
			'ffmpeg',
			[
				'-v',
				'error',
				'-i',
				path,
				'-map',
				'0:v:0',
				'-map',
				'0:a:0?',
				'-c',
				'copy',
				...videoFilter,
				'-f',
				'streamhash',
				'-'
			],
			toolOptions
		)
	).stdout;
}

function idat(bytes: Buffer): Buffer {
	const chunks: Buffer[] = [];
	for (let offset = 8; offset + 12 <= bytes.length;) {
		const size = bytes.readUInt32BE(offset);
		if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
			chunks.push(bytes.subarray(offset + 8, offset + 8 + size));
		}
		offset += 12 + size;
	}
	return Buffer.concat(chunks);
}

describe('private memory uploads', () => {
	it.each(['jpeg', 'png', 'heic'] as const)(
		'cleans a %s without re-encoding it',
		async (type) => {
			const input = join(test.dir, `source.${type}`);
			if (type === 'heic') {
				writeFileSync(input, readFileSync('tests/fixtures/media/synthetic.heic'));
			} else {
				await sharp({ create: { width: 48, height: 36, channels: 3, background: '#a65c82' } })
					.toFormat(type)
					.toFile(input);
			}
			await tag(input);
			expect(await metadata(input)).toContain(marker);
			const source = readFileSync(input);
			const result = await upload(source, 'test with an unrelated extension.svg');
			expect(result.coordinates).toEqual({ lat: 12.34, lon: 56.78 });
			const entry = test.db.select().from(memory).get()!;
			expect(entry).toMatchObject({
				captureDate: date,
				sortDate: date,
				eventId,
				caption: 'Test caption',
				createdBy: actor
			});
			expect(test.db.select().from(event).get()).toMatchObject({ lat: null, lon: null });

			const original = await download(result.id, 'original');
			const tags = await metadata(original.path);
			expect(tags).toContain('2020:02:03 12:34:56');
			expect(tags).toContain('Orientation');
			expect(tags).not.toMatch(/GPS|Synthetic private location/);
			expect(original.bytes.includes(marker)).toBe(false);
			if (type === 'heic') expect(await streamHash(original.path)).toEqual(await streamHash(input));
			if (type === 'png') expect(idat(original.bytes)).toEqual(idat(source));
			if (type === 'jpeg') {
				const scan = Buffer.from([0xff, 0xda]);
				expect(original.bytes.subarray(original.bytes.indexOf(scan))).toEqual(
					source.subarray(source.indexOf(scan))
				);
			}

			for (const variant of ['thumbnail', 'preview'] as const) {
				const image = await download(result.id, variant);
				expect(await metadata(image.path)).toBe('');
				expect(await sharp(image.bytes).metadata()).toMatchObject({ width: 36, height: 48 });
			}
			const key = deriveKeys(test.key).field;
			const proof = offerCoordinates(key, 'test-session', result.id, eventId, result.coordinates!);
			expect(acceptCoordinates(test.db, key, 'other-session', result.id, proof)).toBe(false);
			expect(acceptCoordinates(test.db, key, 'test-session', result.id, proof)).toBe(true);
			expect(acceptCoordinates(test.db, key, 'test-session', result.id, proof)).toBe(false);
			expect(test.db.select().from(event).get()).toMatchObject({ lat: 12.34, lon: 56.78 });
		},
		20_000
	);

	it.each(['mp4', 'mov'] as const)(
		'remuxes %s, removing location atoms and retaining compressed streams',
		async (type) => {
			const input = join(test.dir, `source.${type}`);
			await runTool(
				'ffmpeg',
				[
					'-v',
					'error',
					'-f',
					'lavfi',
					'-i',
					'color=c=blue:s=64x48:r=10',
					'-f',
					'lavfi',
					'-i',
					'sine=440',
					'-t',
					'0.3',
					'-c:v',
					'libx264',
					'-threads',
					'1',
					'-c:a',
					'aac',
					'-metadata',
					'creation_time=2020-02-03T12:34:56Z',
					'-metadata',
					'location=+12.3400+056.7800/',
					'-metadata',
					'com.apple.quicktime.location.ISO6709=+12.3400+056.7800/',
					'-movflags',
					'use_metadata_tags',
					input
				],
				toolOptions
			);
			expect(await metadata(input)).toMatch(/Location|GPSCoordinates/);
			const result = await upload(readFileSync(input), `synthetic.${type}`);
			expect(result.coordinates).toBeNull();
			expect(test.db.select().from(memory).get()?.captureDate).toBe(date);
			const original = await download(result.id, 'original');
			const preview = await download(result.id, 'preview');
			const poster = await download(result.id, 'thumbnail');
			for (const file of [original, preview, poster]) {
				expect(await metadata(file.path)).not.toMatch(/GPS|Location/);
				expect(file.bytes.includes('+12.3400+056.7800')).toBe(false);
			}
			const normalize = ['-bsf:v', 'h264_mp4toannexb,filter_units=remove_types=6'];
			expect(await streamHash(original.path, normalize)).toEqual(
				await streamHash(input, normalize)
			);
			expect(await sharp(poster.bytes).metadata()).toMatchObject({
				format: 'jpeg',
				width: 64,
				height: 48
			});
		},
		20_000
	);

	it('rejects unknown content, malformed data, oversized requests/files and extra fields', async () => {
		await expect(
			upload('<svg xmlns="http://www.w3.org/2000/svg"/>', 'image.jpg')
		).rejects.toMatchObject({ code: 'unsupported' });
		await expect(upload(Buffer.from([0xff, 0xd8, 0xff, 0x11]), 'broken.jpg')).rejects.toMatchObject(
			{ code: 'unsupported' }
		);
		instance.config.limits = { maxFileBytes: 32, maxRequestBytes: 1024 };
		await expect(upload(Buffer.alloc(33), 'too-large.jpg')).rejects.toMatchObject({ code: 'size' });
		await expect(
			upload(Buffer.alloc(8), 'declared-large.jpg', { length: '1025' })
		).rejects.toMatchObject({ code: 'size' });
		await expect(upload(Buffer.alloc(2048), 'stream-too-large.jpg')).rejects.toMatchObject({
			code: 'size'
		});
		await expect(upload(Buffer.alloc(8), 'extra.jpg', { extra: true })).rejects.toMatchObject({
			code: 'invalid'
		});
		expect(test.db.select().from(memory).all()).toEqual([]);
	});

	it('recovers encrypted orphan files left by a process crash', async () => {
		const file = await storeMediaFile(test.dir, instance.wrappingKey, 4, [Buffer.from('data')]);
		expect(readdirSync(join(test.dir, 'media'))).toEqual([file.id]);
		cleanOrphanMedia(test.db, test.dir);
		expect(readdirSync(join(test.dir, 'media'))).toEqual([]);
	});
});
