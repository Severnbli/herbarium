import { z } from 'zod';
import { normalizeDate, validTimeZone } from '#lib/domain/event-date.ts';
import { REMINDER_OFFSETS, type ReminderOffset } from '#lib/domain/reminder.ts';
import { displayName } from '#lib/server/auth/schemas.ts';
import { MEDIA_TYPES } from '#lib/server/db/schema.ts';
import {
	originalLocalStart,
	OCCASION_TYPES,
	readRecurrence
} from '#lib/server/events/recurrence.ts';
import { CATEGORIES } from '#lib/server/events/schemas.ts';
import { mediaId } from '#lib/server/media/store.ts';

export const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
export const MAX_ARCHIVE_ROWS = 100_000;
export const MANIFEST_PATH = 'herbarium.json';
const timestamp = z.iso.datetime({ precision: 3 }).transform((value) => new Date(value));
const localDate = z.iso.date().refine((value) => !value.startsWith('0000'));
const author = { createdBy: mediaId, createdAt: timestamp };

const archivedEvent = z
	.strictObject({
		id: mediaId,
		kind: z.enum(['moment', 'plan', 'occasion']),
		title: z.string().min(1).max(200),
		notes: z.string().max(20_000),
		place: z.string().max(200),
		lat: z.number().min(-90).max(90).nullable(),
		lon: z.number().min(-180).max(180).nullable(),
		category: z.enum(CATEGORIES),
		dateMode: z.enum(['date', 'timed', 'undated']),
		precision: z.enum(['day', 'month', 'year']),
		startDate: localDate.nullable(),
		endDate: localDate.nullable(),
		startsAt: timestamp.nullable(),
		endsAt: timestamp.nullable(),
		timeZone: z.string().max(100).refine(validTimeZone).nullable(),
		sortDate: localDate.nullable(),
		recurrenceRule: z.string().max(32).nullable(),
		occasionType: z.enum(OCCASION_TYPES).nullable(),
		...author,
		updatedAt: timestamp
	})
	.refine((row) => {
		if ((row.lat === null) !== (row.lon === null)) return false;
		try {
			if (row.kind === 'occasion') {
				if (row.precision !== 'day' || !row.recurrenceRule || !row.occasionType) return false;
				const { frequency, interval } = readRecurrence(row.recurrenceRule);
				if (row.occasionType !== 'general' && (frequency !== 'YEARLY' || interval !== 1))
					return false;
			} else if (row.recurrenceRule || row.occasionType) {
				return false;
			}
			if (row.dateMode === 'undated')
				return (
					row.kind === 'plan' &&
					row.precision === 'day' &&
					[row.startDate, row.endDate, row.startsAt, row.endsAt, row.timeZone, row.sortDate].every(
						(field) => field === null
					)
				);
			if (row.sortDate === null) return false;
			if (row.dateMode === 'date') {
				return (
					row.startDate === row.sortDate &&
					row.startsAt === null &&
					row.endsAt === null &&
					row.timeZone === null &&
					[row.startDate, row.endDate].every((date) => {
						const length = { day: 10, month: 7, year: 4 }[row.precision];
						return date === null || normalizeDate(date.slice(0, length), row.precision) === date;
					}) &&
					(row.endDate === null || row.endDate >= row.sortDate)
				);
			}
			return (
				row.precision === 'day' &&
				row.startDate === null &&
				row.endDate === null &&
				row.startsAt !== null &&
				row.timeZone !== null &&
				(row.endsAt === null || row.endsAt > row.startsAt) &&
				originalLocalStart(row).slice(0, 10) === row.sortDate
			);
		} catch {
			return false;
		}
	});

const archivedMemory = z
	.strictObject({
		id: mediaId,
		eventId: mediaId.nullable(),
		originalName: z.string().min(1).max(255),
		altText: z.string().max(280),
		caption: z.string().max(1000),
		captureDate: z.iso.date().nullable(),
		sortDate: z.iso.date(),
		...author,
		original: z.strictObject({
			contentType: z.enum(MEDIA_TYPES),
			size: z
				.int()
				.positive()
				.max(2 * 1024 ** 3)
		})
	})
	.refine((row) => row.captureDate === null || row.sortDate === row.captureDate);

const reminderOffset = z.custom<ReminderOffset>((value) =>
	REMINDER_OFFSETS.some(({ minutes }) => minutes === value)
);
export const archiveManifest = z
	.strictObject({
		version: z.union([z.literal(1), z.literal(2)]),
		exportedAt: timestamp,
		authors: z
			.array(z.strictObject({ id: mediaId, displayName, createdAt: timestamp }))
			.max(MAX_ARCHIVE_ROWS),
		events: z.array(archivedEvent).max(MAX_ARCHIVE_ROWS),
		memories: z.array(archivedMemory).max(MAX_ARCHIVE_ROWS),
		albums: z
			.array(
				z.strictObject({
					id: mediaId,
					title: z.string().min(1).max(120),
					...author
				})
			)
			.max(MAX_ARCHIVE_ROWS),
		albumMemories: z
			.array(z.strictObject({ albumId: mediaId, memoryId: mediaId }))
			.max(MAX_ARCHIVE_ROWS),
		reminders: z
			.array(
				z.strictObject({
					eventId: mediaId,
					minutes: reminderOffset,
					createdAt: timestamp
				})
			)
			.max(MAX_ARCHIVE_ROWS)
	})
	.refine((row) => row.version === 2 || row.events.every((event) => event.dateMode !== 'undated'));

export type ArchiveManifest = z.output<typeof archiveManifest>;

const extensions = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/heic': 'heic',
	'video/mp4': 'mp4',
	'video/quicktime': 'mov'
} as const;

export function originalPath(memory: ArchiveManifest['memories'][number]) {
	return `originals/${memory.id}.${extensions[memory.original.contentType]}`;
}
