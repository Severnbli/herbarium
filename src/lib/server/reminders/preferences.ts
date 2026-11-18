import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { validTimeZone } from '#lib/domain/event-date.ts';
import { REMINDER_OFFSETS, type ReminderOffset } from '#lib/domain/reminder.ts';
import type { Locale } from '#lib/i18n/index.ts';
import type { Db } from '../db/index.ts';
import { eventReminder, reminderDelivery, reminderPreference } from '../db/schema.ts';
import { DEFAULT_CALENDAR_ZONE } from '../events/calendar.ts';
import { findEvent } from '../events/events.ts';

const checkbox = z.literal('on').optional();
const offsetFields = {
	atStart: checkbox,
	minutes15: checkbox,
	hour1: checkbox,
	day1: checkbox,
	week1: checkbox
} satisfies Record<(typeof REMINDER_OFFSETS)[number]['field'], typeof checkbox>;

export const reminderOffsetsForm = z
	.strictObject(offsetFields)
	.transform((values) =>
		REMINDER_OFFSETS.filter(({ field }) => values[field] === 'on').map(({ minutes }) => minutes)
	);

const email = z.email().max(254);
export const reminderPreferencesForm = z
	.strictObject({
		enabled: checkbox,
		email: z
			.string()
			.trim()
			.pipe(z.union([z.literal(''), email])),
		timeZone: z.string().trim().max(100).refine(validTimeZone)
	})
	.refine((value) => !value.enabled || value.email !== '', { path: ['email'] });

export function getReminderPreferences(db: Db, userId: string) {
	return (
		db
			.select({
				enabled: reminderPreference.enabled,
				email: reminderPreference.email,
				timeZone: reminderPreference.timeZone
			})
			.from(reminderPreference)
			.where(eq(reminderPreference.userId, userId))
			.get() ?? { enabled: false, email: '', timeZone: DEFAULT_CALENDAR_ZONE }
	);
}

export function saveReminderPreferences(
	db: Db,
	userId: string,
	input: z.input<typeof reminderPreferencesForm>,
	locale: Locale,
	now = new Date()
) {
	const data = reminderPreferencesForm.parse(input);
	const values = { email: data.email, timeZone: data.timeZone, enabled: data.enabled === 'on' };
	db.transaction(
		(tx) => {
			const current = tx
				.select()
				.from(reminderPreference)
				.where(eq(reminderPreference.userId, userId))
				.get();
			const changed =
				!current ||
				current.email !== values.email ||
				current.timeZone !== values.timeZone ||
				current.enabled !== values.enabled;
			const update = { ...values, locale, changedAt: changed ? now : current.changedAt };
			tx.insert(reminderPreference)
				.values({ userId, ...update })
				.onConflictDoUpdate({
					target: reminderPreference.userId,
					set: update
				})
				.run();
			if (changed) {
				tx.delete(reminderDelivery)
					.where(and(eq(reminderDelivery.userId, userId), eq(reminderDelivery.status, 'pending')))
					.run();
			}
		},
		{ behavior: 'immediate' }
	);
}

export function getReminderOffsets(db: Db, eventId: string) {
	return db
		.select({ minutes: eventReminder.minutes })
		.from(eventReminder)
		.where(eq(eventReminder.eventId, eventId))
		.all()
		.map(({ minutes }) => minutes);
}

export function saveReminderOffsets(
	db: Db,
	eventId: string,
	offsets: ReminderOffset[],
	now = new Date()
): boolean {
	return db.transaction(
		(tx) => {
			if (findEvent(tx, eventId).precision !== 'day') return false;
			const removed = tx
				.delete(eventReminder)
				.where(and(eq(eventReminder.eventId, eventId), notInArray(eventReminder.minutes, offsets)))
				.returning({ minutes: eventReminder.minutes })
				.all();
			if (removed.length) {
				tx.delete(reminderDelivery)
					.where(
						and(
							eq(reminderDelivery.eventId, eventId),
							eq(reminderDelivery.status, 'pending'),
							inArray(
								reminderDelivery.minutes,
								removed.map(({ minutes }) => minutes)
							)
						)
					)
					.run();
			}
			if (offsets.length) {
				tx.insert(eventReminder)
					.values(offsets.map((minutes) => ({ eventId, minutes, createdAt: now })))
					.onConflictDoNothing()
					.run();
			}
			return true;
		},
		{ behavior: 'immediate' }
	);
}
