import { z } from 'zod';
import { readCoordinate } from '#lib/domain/location.ts';
import {
	DISAMBIGUATIONS,
	PRECISIONS,
	localToInstant,
	normalizeDate,
	validTimeZone
} from '#lib/domain/event-date.ts';

import { FREQUENCIES, OCCASION_TYPES } from './recurrence.ts';

export const eventId = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
export const CATEGORIES = ['none', 'trip', 'date', 'milestone'] as const;
const coordinate = (min: number, max: number) =>
	z
		.string()
		.trim()
		.max(32)
		.refine((value) => value === '' || readCoordinate(value, min, max) !== null);

export const eventFormSchema = z
	.strictObject({
		kind: z.enum(['moment', 'plan', 'occasion']),
		repeat: z.enum(['yearly', 'monthly', 'custom']).default('yearly'),
		frequency: z.enum(FREQUENCIES).default('WEEKLY'),
		interval: z
			.string()
			.regex(/^[1-9]\d?$/)
			.default('1'),
		occasionType: z.enum(OCCASION_TYPES).default('general'),
		title: z.string().trim().min(1).max(200),
		notes: z.string().max(20_000),
		place: z.string().trim().max(200),
		lat: coordinate(-90, 90),
		lon: coordinate(-180, 180),
		category: z.enum(CATEGORIES),
		dateMode: z.enum(['date', 'timed']),
		precision: z.enum(PRECISIONS),
		start: z.string().trim().min(1).max(32),
		end: z.string().trim().max(32),
		timeZone: z.string().trim().max(100),
		disambiguation: z.enum(DISAMBIGUATIONS),
		endDisambiguation: z.enum(DISAMBIGUATIONS)
	})
	.superRefine((value, context) => {
		const issue = (path: string, message: string) =>
			context.addIssue({ code: 'custom', path: [path], message });
		if (value.kind === 'occasion') {
			if (value.precision !== 'day') issue('precision', 'Occasions require day precision');
			if (value.occasionType !== 'general' && value.repeat !== 'yearly')
				issue('occasionType', 'Birthdays and anniversaries require yearly recurrence');
		}
		if ((value.lat === '') !== (value.lon === '')) issue('lat', 'Coordinates require a pair');
		if (value.dateMode === 'timed' && value.precision !== 'day')
			issue('precision', 'Timed dates require day precision');

		if (value.dateMode === 'timed' && !validTimeZone(value.timeZone))
			issue('timeZone', 'Invalid time zone');
		let start: string | number;
		try {
			start =
				value.dateMode === 'date'
					? normalizeDate(value.start, value.precision)
					: localToInstant(value.start, value.timeZone, value.disambiguation).getTime();
		} catch {
			issue('start', 'Invalid date or ambiguous local time');
			return;
		}
		if (value.end) {
			try {
				const end =
					value.dateMode === 'date'
						? normalizeDate(value.end, value.precision)
						: localToInstant(value.end, value.timeZone, value.endDisambiguation).getTime();
				if (end < start || (value.dateMode === 'timed' && end === start))
					issue('end', 'End must follow start');
			} catch {
				issue('end', 'Invalid date or ambiguous local time');
			}
		}
	});

export type EventForm = z.infer<typeof eventFormSchema>;
export const emptyEventForm: EventForm = {
	kind: 'moment',
	repeat: 'yearly',
	frequency: 'WEEKLY',
	interval: '1',
	occasionType: 'general',
	title: '',
	notes: '',
	place: '',
	lat: '',
	lon: '',
	category: 'none',
	dateMode: 'date',
	precision: 'day',
	start: '',
	end: '',
	timeZone: 'Europe/Minsk',
	disambiguation: 'reject',
	endDisambiguation: 'reject'
};

export const eventFilters = z.strictObject({
	kind: z.enum(['', 'moment', 'plan', 'occasion']).default(''),
	year: z
		.string()
		.regex(/^(?:[0-9]{4})?$/)
		.refine((v) => v !== '0000')
		.default(''),
	page: z
		.string()
		.regex(/^[1-9]\d{0,5}$/)
		.default('1')
});
