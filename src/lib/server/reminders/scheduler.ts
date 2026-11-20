import { Temporal } from '@js-temporal/polyfill';
import { and, asc, eq, gte, isNull, lt, lte, ne } from 'drizzle-orm';
import { formatEventDate, type EventDate } from '#lib/domain/event-date.ts';
import { REMINDER_OFFSETS } from '#lib/domain/reminder.ts';
import type { Db } from '../db/index.ts';
import { event, eventReminder, reminderDelivery, reminderPreference, user } from '../db/schema.ts';
import { expandOccasion } from '../events/recurrence.ts';
import type { Locale } from '#lib/i18n/index.ts';

const MINUTE = 60_000;
const DAY = 1440 * MINUTE;
const HORIZON = 14 * DAY;
const MAX_OFFSET = Math.max(...REMINDER_OFFSETS.map(({ minutes }) => minutes)) * MINUTE;
const MAX_LATENESS = DAY;
const RETRY_MINUTES = [1, 5, 15, 60];
const POLL_INTERVAL = MINUTE;
const BATCH_SIZE = 30;

const eventFields = {
	id: event.id,
	title: event.title,
	kind: event.kind,
	sortDate: event.sortDate,
	dateMode: event.dateMode,
	precision: event.precision,
	startDate: event.startDate,
	endDate: event.endDate,
	startsAt: event.startsAt,
	endsAt: event.endsAt,
	timeZone: event.timeZone,
	recurrenceRule: event.recurrenceRule,
	occasionType: event.occasionType,
	updatedAt: event.updatedAt
};

type ReminderEvent = Pick<typeof event.$inferSelect, keyof typeof eventFields>;
type Delivery = typeof reminderDelivery.$inferSelect;
type DeliveryKey = Pick<Delivery, 'eventId' | 'userId' | 'occurrence' | 'minutes'>;
const deliveryColumns = [
	reminderDelivery.eventId,
	reminderDelivery.userId,
	reminderDelivery.occurrence,
	reminderDelivery.minutes
] as const;

export interface ReminderMail {
	to: string;
	locale: Locale;
	title: string;
	date: string;
	eventId: string;
}

export type DeliveryResult = 'sent' | 'retry' | 'failed' | 'uncertain';
type SendReminder = (message: ReminderMail) => Promise<DeliveryResult>;

function startsBetween(value: ReminderEvent, first: string, last: string) {
	if (value.precision !== 'day' || !value.sortDate) return [];
	if (value.kind === 'occasion' && value.recurrenceRule) {
		return expandOccasion(
			{
				...value,
				recurrenceRule: value.recurrenceRule,
				occasionType: value.occasionType ?? 'general'
			},
			first,
			last
		);
	}
	return value.sortDate >= first && value.sortDate <= last ? [{ date: value.sortDate, value }] : [];
}

function reminderStart(value: EventDate, timeZone: string) {
	if (value.startsAt) return value.startsAt.getTime();
	const day = Temporal.PlainDate.from(value.startDate!);
	const zoned = day.toZonedDateTime({ timeZone, plainTime: '09:00' });
	// Whole dates can be skipped when a zone moves across the international date line.
	return zoned.toPlainDate().equals(day) ? zoned.epochMilliseconds : null;
}

const dueDate = (time: number) => new Date(time).toISOString().slice(0, 10);

function deliveryKey(job: DeliveryKey) {
	return and(
		eq(reminderDelivery.eventId, job.eventId),
		eq(reminderDelivery.userId, job.userId),
		eq(reminderDelivery.occurrence, job.occurrence),
		eq(reminderDelivery.minutes, job.minutes)
	);
}

function refreshQueue(db: Db, now: Date) {
	const current = now.getTime();
	const from = dueDate(current - MAX_LATENESS - 2 * DAY);
	const through = dueDate(current + HORIZON + MAX_OFFSET + 2 * DAY);
	db.transaction(
		(tx) => {
			tx.delete(reminderDelivery)
				.where(
					and(
						eq(reminderDelivery.status, 'pending'),
						lt(reminderDelivery.dueAt, new Date(current - MAX_LATENESS))
					)
				)
				.run();
			const recipients = tx
				.select({
					id: user.id,
					timeZone: reminderPreference.timeZone,
					changedAt: reminderPreference.changedAt
				})
				.from(reminderPreference)
				.innerJoin(user, eq(user.id, reminderPreference.userId))
				.where(and(eq(reminderPreference.enabled, true), isNull(user.deactivatedAt)))
				.all();
			if (!recipients.length) return;

			const candidates = tx
				.select({ value: eventFields, offset: eventReminder })
				.from(eventReminder)
				.innerJoin(event, eq(event.id, eventReminder.eventId))
				.where(and(eq(event.precision, 'day'), lte(event.sortDate, through)))
				.all();
			for (const group of Map.groupBy(candidates, ({ value }) => value.id).values()) {
				const value = group[0]!.value;
				for (const occurrence of startsBetween(value, from, through)) {
					for (const recipient of recipients) {
						const start = reminderStart(occurrence.value, recipient.timeZone);
						if (start === null) continue;
						for (const { offset } of group) {
							const due = start - offset.minutes * MINUTE;
							// Rebuild recent due reminders if the process stopped before its next poll.
							// Only materialize jobs that were eligible when they first became due.
							const earliest = Math.max(
								current - MAX_LATENESS,
								value.updatedAt.getTime(),
								recipient.changedAt.getTime(),
								offset.createdAt.getTime()
							);
							if (due < earliest || due > current + HORIZON) continue;

							const dueAt = new Date(due);
							tx.insert(reminderDelivery)
								.values({
									eventId: value.id,
									userId: recipient.id,
									occurrence: occurrence.date,
									minutes: offset.minutes,
									dueAt,
									nextAttemptAt: dueAt
								})
								.onConflictDoUpdate({
									target: [...deliveryColumns],
									set: { dueAt, nextAttemptAt: dueAt, attempts: 0 },
									setWhere: and(
										eq(reminderDelivery.status, 'pending'),
										ne(reminderDelivery.dueAt, dueAt)
									)
								})
								.run();
						}
					}
				}
			}
		},
		{ behavior: 'immediate' }
	);
}

function currentMail(db: Db, job: Delivery): ReminderMail | null {
	const recipient = db
		.select({
			preference: reminderPreference,
			locale: user.locale
		})
		.from(reminderPreference)
		.innerJoin(user, eq(user.id, reminderPreference.userId))
		.where(
			and(eq(user.id, job.userId), eq(reminderPreference.enabled, true), isNull(user.deactivatedAt))
		)
		.get();
	const scheduled = db
		.select({ value: eventFields, offset: eventReminder })
		.from(eventReminder)
		.innerJoin(event, eq(event.id, eventReminder.eventId))
		.where(and(eq(event.id, job.eventId), eq(eventReminder.minutes, job.minutes)))
		.get();
	if (!recipient || !scheduled) return null;

	const occurrence = startsBetween(scheduled.value, job.occurrence, job.occurrence)[0];
	if (!occurrence) return null;
	const start = reminderStart(occurrence.value, recipient.preference.timeZone);
	const due = job.dueAt.getTime();
	if (
		start === null ||
		start - job.minutes * MINUTE !== due ||
		recipient.preference.changedAt.getTime() > due ||
		scheduled.offset.createdAt.getTime() > due
	)
		return null;
	const locale = recipient.locale ?? recipient.preference.locale;
	return {
		to: recipient.preference.email,
		locale,
		title: scheduled.value.title,
		date:
			formatEventDate(locale, occurrence.value) +
			(occurrence.value.timeZone ? ` (${occurrence.value.timeZone})` : ''),
		eventId: job.eventId
	};
}

function claimNext(db: Db, now: Date) {
	return db.transaction(
		(tx) => {
			const job = tx
				.select()
				.from(reminderDelivery)
				.where(
					and(
						eq(reminderDelivery.status, 'pending'),
						lte(reminderDelivery.nextAttemptAt, now),
						gte(reminderDelivery.dueAt, new Date(now.getTime() - MAX_LATENESS))
					)
				)
				.orderBy(asc(reminderDelivery.nextAttemptAt))
				.get();
			if (!job) return null;
			const mail = currentMail(tx, job);
			if (!mail) {
				tx.delete(reminderDelivery).where(deliveryKey(job)).run();
				return { job, mail: null };
			}
			// Commit the claim before crossing the SMTP boundary. A process lost during delivery
			// leaves this key claimed, so another process cannot send it a second time.
			job.attempts += 1;
			tx.update(reminderDelivery)
				.set({ status: 'claimed', attempts: job.attempts })
				.where(deliveryKey(job))
				.run();
			return { job, mail };
		},
		{ behavior: 'immediate' }
	);
}

export async function runReminders(db: Db, send: SendReminder, clock = () => new Date()) {
	refreshQueue(db, clock());
	for (let i = 0; i < BATCH_SIZE; i++) {
		const claim = claimNext(db, clock());
		if (!claim) break;
		const { job, mail } = claim;
		if (!mail) continue;

		const result = await send(mail);
		const retry = result === 'retry' ? RETRY_MINUTES[job.attempts - 1] : undefined;
		const next = retry ? new Date(clock().getTime() + retry * MINUTE) : null;
		const retryAt = next && next.getTime() <= job.dueAt.getTime() + MAX_LATENESS ? next : null;
		db.update(reminderDelivery)
			.set(
				retryAt
					? { status: 'pending', nextAttemptAt: retryAt }
					: { status: result === 'retry' ? 'failed' : result }
			)
			.where(and(deliveryKey(job), eq(reminderDelivery.status, 'claimed')))
			.run();
	}
}

export function startReminderScheduler(db: Db, send: SendReminder) {
	let running = false;
	const poll = async () => {
		if (running) return;
		running = true;
		try {
			await runReminders(db, send);
		} catch {
			// SMTP and SQL errors can include private data and credentials.
			console.error('The reminder scheduler could not finish a delivery cycle.');
		} finally {
			running = false;
		}
	};
	void poll();
	return setInterval(() => void poll(), POLL_INTERVAL).unref();
}
