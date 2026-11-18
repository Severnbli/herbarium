export const REMINDER_OFFSETS = [
	{ field: 'atStart', minutes: 0 },
	{ field: 'minutes15', minutes: 15 },
	{ field: 'hour1', minutes: 60 },
	{ field: 'day1', minutes: 1440 },
	{ field: 'week1', minutes: 10080 }
] as const;

export type ReminderOffset = (typeof REMINDER_OFFSETS)[number]['minutes'];
