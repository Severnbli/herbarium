import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { addUser } from '../auth/fixtures.ts';
import { updateLocale } from '../auth/preferences.ts';
import { openDatabase } from '../db/index.ts';
import { reminderDelivery, user } from '../db/schema.ts';
import { createEvent, updateEvent } from '../events/events.ts';
import { emptyEventForm } from '../events/schemas.ts';
import { createTestDb } from '../testing.ts';
import { saveReminderOffsets, saveReminderPreferences } from './preferences.ts';
import { runReminders, type DeliveryResult, type ReminderMail } from './scheduler.ts';

let fixture: ReturnType<typeof createTestDb>;
beforeEach(() => {
	fixture = createTestDb();
});
afterEach(() => fixture.cleanup());

const eventForm = { ...emptyEventForm, kind: 'plan', title: 'Synthetic reminder' } as const;
const preferences = {
	email: 'member@example.test',
	enabled: 'on',
	timeZone: 'America/New_York'
} as const;
const at = (iso: string) => () => new Date(iso);
const sender = (result: DeliveryResult = 'sent') =>
	vi.fn<(mail: ReminderMail) => Promise<DeliveryResult>>(async () => result);

it('schedules all-day dates in the recipient zone and timed occasions in the event zone across DST', async () => {
	const { db } = fixture;
	const member = await addUser(db, 'member');
	const now = at('2026-03-06T12:00:00Z');
	saveReminderPreferences(db, member, preferences, 'be', now());

	const timed = createEvent(
		db,
		member,
		{
			...eventForm,
			kind: 'occasion',
			repeat: 'custom',
			frequency: 'DAILY',
			dateMode: 'timed',
			start: '2026-03-07T02:30',
			timeZone: 'America/New_York'
		},
		now()
	);
	const allDay = createEvent(
		db,
		member,
		{
			...eventForm,
			kind: 'occasion',
			repeat: 'custom',
			frequency: 'DAILY',
			start: '2026-03-07'
		},
		now()
	);
	saveReminderOffsets(db, timed, [60], now());
	saveReminderOffsets(db, allDay, [0], now());
	const send = sender();
	await runReminders(db, send, now);
	expect(send).not.toHaveBeenCalled();

	const dates = (id: string) =>
		db
			.select()
			.from(reminderDelivery)
			.where(eq(reminderDelivery.eventId, id))
			.all()
			.map(({ dueAt }) => dueAt.toISOString())
			.sort();
	expect(dates(timed).slice(0, 2)).toEqual([
		'2026-03-07T06:30:00.000Z',
		'2026-03-09T05:30:00.000Z'
	]);
	expect(dates(allDay).slice(0, 2)).toEqual([
		'2026-03-07T14:00:00.000Z',
		'2026-03-08T13:00:00.000Z'
	]);
});

it('preserves the selected original fold and measures timed offsets in elapsed minutes', async () => {
	const { db } = fixture;
	const member = await addUser(db, 'member');
	const now = at('2026-10-31T12:00:00Z');
	saveReminderPreferences(db, member, { ...preferences, timeZone: 'Asia/Kathmandu' }, 'en', now());
	const id = createEvent(
		db,
		member,
		{
			...eventForm,
			dateMode: 'timed',
			start: '2026-11-01T01:30',
			timeZone: 'America/New_York',
			disambiguation: 'later'
		},
		now()
	);
	saveReminderOffsets(db, id, [60], now());
	await runReminders(db, sender(), now);
	expect(db.select().from(reminderDelivery).get()?.dueAt.toISOString()).toBe(
		'2026-11-01T05:30:00.000Z'
	);
});

it('delivers a queued reminder after downtime and retains a transient retry across restart', async () => {
	const { db, path, key } = fixture;
	const member = await addUser(db, 'member');
	const now = at('2026-03-01T10:00:00Z');
	const id = createEvent(db, member, { ...eventForm, start: '2026-03-03' }, now());
	saveReminderOffsets(db, id, [0], now());
	saveReminderPreferences(db, member, preferences, 'be', now());
	const send = sender().mockResolvedValueOnce('retry');
	await runReminders(db, send, now);

	const restarted = openDatabase({ path, key });
	try {
		updateLocale(restarted.db, member, 'ru');
		await runReminders(restarted.db, send, at('2026-03-03T14:10:00Z'));
		expect(send).toHaveBeenCalledExactlyOnceWith({
			to: preferences.email,
			locale: 'ru',
			title: eventForm.title,
			date: expect.stringContaining('марта'),
			eventId: id
		});
	} finally {
		restarted.close();
	}
	expect(db.select().from(reminderDelivery).get()).toMatchObject({
		status: 'pending',
		attempts: 1,
		nextAttemptAt: new Date('2026-03-03T14:11:00Z')
	});
	await runReminders(db, send, at('2026-03-03T14:10:59Z'));
	expect(send).toHaveBeenCalledTimes(1);
	await runReminders(db, send, at('2026-03-03T14:11:00Z'));
	await runReminders(db, send, at('2026-03-03T14:12:00Z'));
	expect(send).toHaveBeenCalledTimes(2);
	expect(db.select().from(reminderDelivery).get()).toMatchObject({ status: 'sent', attempts: 2 });
});

it('recovers a recent reminder even if the last process stopped before its first poll', async () => {
	const { db, path, key } = fixture;
	const member = await addUser(db, 'member');
	const now = at('2026-03-02T13:59:45Z');
	const id = createEvent(db, member, { ...eventForm, start: '2026-03-02' }, now());
	const past = createEvent(db, member, { ...eventForm, start: '2026-03-01' }, now());
	saveReminderOffsets(db, id, [0], now());
	saveReminderOffsets(db, past, [0], now());
	saveReminderPreferences(db, member, preferences, 'en', now());

	const restarted = openDatabase({ path, key });
	try {
		const send = sender();
		await runReminders(restarted.db, send, at('2026-03-02T14:15:00Z'));
		expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ eventId: id }));
	} finally {
		restarted.close();
	}
});

it('never sends the same claimed reminder after a crash or from another connection', async () => {
	const { db, path, key } = fixture;
	const member = await addUser(db, 'member');
	const now = at('2026-03-02T12:00:00Z');
	const id = createEvent(db, member, { ...eventForm, start: '2026-03-02' }, now());
	saveReminderOffsets(db, id, [0], now());
	saveReminderPreferences(db, member, preferences, 'en', now());

	const crash = vi.fn(async () => {
		throw new Error('Simulated crash after SMTP submission');
	});
	await expect(runReminders(db, crash, at('2026-03-02T14:00:00Z'))).rejects.toThrow(
		'Simulated crash'
	);
	expect(db.select().from(reminderDelivery).get()?.status).toBe('claimed');

	const restarted = openDatabase({ path, key });
	try {
		const send = sender();
		await runReminders(restarted.db, send, at('2026-03-02T14:01:00Z'));
		expect(send).not.toHaveBeenCalled();
	} finally {
		restarted.close();
	}
});

it('revalidates changed event times and opted-out or deactivated members before delivery', async () => {
	const { db } = fixture;
	const member = await addUser(db, 'member');
	const optedOut = await addUser(db, 'optedout');
	const inactive = await addUser(db, 'inactive');
	const now = at('2026-03-02T12:00:00Z');
	for (const id of [member, optedOut, inactive])
		saveReminderPreferences(db, id, preferences, 'en', now());
	const initial = {
		...eventForm,
		dateMode: 'timed',
		timeZone: 'UTC',
		start: '2026-03-02T14:00'
	} as const;
	const id = createEvent(db, member, initial, now());
	saveReminderOffsets(db, id, [0], now());
	const send = sender('uncertain');
	await runReminders(db, send, now);
	updateEvent(db, id, { ...initial, start: '2026-03-02T15:00' }, now());
	db.update(user).set({ deactivatedAt: now() }).where(eq(user.id, inactive)).run();
	saveReminderPreferences(db, optedOut, { email: '', timeZone: 'UTC' }, 'en', now());
	await runReminders(db, send, at('2026-03-02T14:00:00Z'));
	expect(send).not.toHaveBeenCalled();
	await runReminders(db, send, at('2026-03-02T15:00:00Z'));
	expect(send).toHaveBeenCalledTimes(1);
	expect(db.select().from(reminderDelivery).all()).toEqual([
		expect.objectContaining({ status: 'uncertain', userId: member })
	]);

	saveReminderOffsets(db, id, [], at('2026-03-02T15:01:00Z')());
	saveReminderOffsets(db, id, [0], at('2026-03-02T15:01:00Z')());
	updateEvent(db, id, { ...initial, start: '2026-03-02T16:00' }, now());
	await runReminders(db, send, at('2026-03-02T16:00:00Z'));
	expect(send).toHaveBeenCalledTimes(1);
});
