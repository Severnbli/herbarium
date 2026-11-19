import { createHash } from 'node:crypto';
import { and, count, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { generateId } from '#lib/server/crypto/tokens.ts';
import type { Db } from '#lib/server/db/index.ts';
import {
	album,
	albumMemory,
	importReceipt,
	mediaImport,
	memory,
	memoryFingerprint,
	user
} from '#lib/server/db/schema.ts';
import { createEvent } from '#lib/server/events/events.ts';
import { emptyEventForm } from '#lib/server/events/schemas.ts';
import { acceptCoordinates } from './coordinates.ts';
import { mediaId } from './store.ts';

export const MAX_IMPORT_FILES = 500;
export const browserFingerprint = z.string().regex(/^[0-9a-f]{64}$/);
export const groupFields = z
	.strictObject({
		date: z.union([z.literal(''), z.iso.date().refine((date) => !date.startsWith('0000'))]),
		title: z.string().trim().min(1).max(120),
		revision: browserFingerprint,
		album: z.literal('on').optional(),
		moment: z.literal('on').optional(),
		acceptGps: z.literal('on').optional(),
		gpsId: mediaId.optional(),
		gpsToken: z
			.string()
			.regex(/^[A-Za-z0-9_-]{1,512}$/)
			.optional()
	})
	.refine(
		(input) =>
			(input.album || input.moment) &&
			(!input.moment || input.date) &&
			(!input.acceptGps || (input.moment && input.gpsId && input.gpsToken))
	);

export class ImportError extends Error {
	constructor(public readonly code: 'missing' | 'full' | 'coordinates' | 'session') {
		super(`Media import ${code}`);
	}
}

export function activeImport(db: Db, userId: string) {
	return db
		.select({ id: mediaImport.id })
		.from(mediaImport)
		.where(eq(mediaImport.userId, userId))
		.get();
}

export function startImport(db: Db, userId: string): string {
	return db.transaction(
		(tx) => {
			const existing = activeImport(tx, userId);
			if (existing) return existing.id;
			const id = generateId();
			tx.insert(mediaImport).values({ id, userId }).run();
			return id;
		},
		{ behavior: 'immediate' }
	);
}

export function finishImport(db: Db, importId: string, userId: string) {
	db.delete(mediaImport)
		.where(and(eq(mediaImport.id, importId), eq(mediaImport.userId, userId)))
		.run();
}

export function requireImport(db: Db, importId: string, userId: string) {
	const row = db
		.select({ id: mediaImport.id })
		.from(mediaImport)
		.innerJoin(user, eq(user.id, mediaImport.userId))
		.where(
			and(eq(mediaImport.id, importId), eq(mediaImport.userId, userId), isNull(user.deactivatedAt))
		)
		.get();
	if (!row) throw new ImportError('missing');
}

function receipt(db: Db, importId: string, fingerprint: string) {
	return db
		.select({ duplicate: importReceipt.duplicate })
		.from(importReceipt)
		.where(and(eq(importReceipt.importId, importId), eq(importReceipt.fingerprint, fingerprint)))
		.get();
}

export function checkImportFile(db: Db, importId: string, fingerprint: string) {
	const previous = receipt(db, importId, fingerprint);
	if (previous) return previous.duplicate ? 'duplicate' : 'saved';
	const total = db
		.select({ total: count() })
		.from(importReceipt)
		.where(eq(importReceipt.importId, importId))
		.get()!.total;
	if (total >= MAX_IMPORT_FILES) throw new ImportError('full');
	return null;
}

export function isDuplicate(db: Db, digest: string) {
	return !!db
		.select({ id: memoryFingerprint.memoryId })
		.from(memoryFingerprint)
		.where(eq(memoryFingerprint.digest, digest))
		.limit(1)
		.get();
}

function pendingGroups(db: Db, importId: string) {
	const rows = db
		.select({
			id: memory.id,
			name: memory.originalName,
			captureDate: memory.captureDate,
			eventId: memory.eventId,
			fingerprint: importReceipt.fingerprint
		})
		.from(importReceipt)
		.innerJoin(memory, eq(memory.id, importReceipt.memoryId))
		.where(and(eq(importReceipt.importId, importId), eq(importReceipt.organized, false)))
		.orderBy(memory.captureDate, memory.createdAt, memory.id)
		.all();
	const groups = new Map<string, typeof rows>();
	for (const row of rows) {
		const date = row.captureDate && !row.captureDate.startsWith('0000') ? row.captureDate : '';
		const files = groups.get(date) ?? [];
		files.push(row);
		groups.set(date, files);
	}
	return groups;
}

function groupRevision(files: { id: string }[]) {
	return createHash('sha256')
		.update(files.map(({ id }) => id).join(':'))
		.digest('hex');
}

export function importGroups(db: Db, importId: string) {
	return [...pendingGroups(db, importId)].map(([date, files]) => ({
		date,
		revision: groupRevision(files),
		files: files.map(({ id, name }) => ({ id, name }))
	}));
}

export function organizeImport(
	db: Db,
	importId: string,
	userId: string,
	input: z.output<typeof groupFields>,
	gps: { key: Buffer; sessionId: string }
) {
	return db.transaction(
		(tx) => {
			requireImport(tx, importId, userId);
			const files = pendingGroups(tx, importId).get(input.date);
			if (
				!files?.length ||
				groupRevision(files) !== input.revision ||
				(input.moment && files.some((file) => file.eventId))
			) {
				throw new ImportError('missing');
			}
			const eventId = input.moment
				? createEvent(tx, userId, { ...emptyEventForm, title: input.title, start: input.date })
				: null;
			const albumId = input.album ? generateId() : null;
			if (albumId)
				tx.insert(album).values({ id: albumId, title: input.title, createdBy: userId }).run();
			for (const file of files) {
				if (eventId) tx.update(memory).set({ eventId }).where(eq(memory.id, file.id)).run();
				if (albumId) tx.insert(albumMemory).values({ albumId, memoryId: file.id }).run();
				tx.update(importReceipt)
					.set({ organized: true })
					.where(
						and(
							eq(importReceipt.importId, importId),
							eq(importReceipt.fingerprint, file.fingerprint)
						)
					)
					.run();
			}
			if (
				input.acceptGps &&
				(!files.some((file) => file.id === input.gpsId) ||
					!acceptCoordinates(tx, gps.key, gps.sessionId, input.gpsId!, input.gpsToken!))
			) {
				throw new ImportError('coordinates');
			}
			return { eventId, albumId };
		},
		{ behavior: 'immediate' }
	);
}
