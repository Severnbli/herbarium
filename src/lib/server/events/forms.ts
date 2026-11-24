import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { formObject } from '../auth/schemas.ts';
import {
	emptyEventForm,
	eventFormSchema,
	eventPlaceFields,
	eventId,
	type EventForm
} from './schemas.ts';
import { FREQUENCIES, OCCASION_TYPES } from './recurrence.ts';
import { EventError } from './events.ts';

export function routeEventId(params: Record<string, string | undefined>): string {
	const parsed = z.strictObject({ id: eventId }).safeParse(params);
	if (!parsed.success) error(404, 'not_found');
	return parsed.data.id;
}

/** Reflect only known, bounded text values; never include a password or uploaded file. */
export function parseEventForm(data: FormData) {
	const take = (key: string) => {
		const values = data.getAll(key);
		data.delete(key);
		return values;
	};
	const names = take('extra-place');
	const lats = take('extra-lat');
	const lons = take('extra-lon');
	const saved = take('extra-saved-place-id');
	const safeText = (value: FormDataEntryValue | undefined, length: number) =>
		typeof value === 'string' ? value.slice(0, length) : '';
	const places = names.slice(0, 100).map((place, i) => ({
		place: safeText(place, 200),
		lat: safeText(lats[i], 32),
		lon: safeText(lons[i], 32),
		savedPlaceId: eventId.safeParse(saved[i]).data ?? ''
	}));
	const stops = z
		.array(eventPlaceFields)
		.max(100)
		.safeParse(
			names.map((place, i) => ({ place, lat: lats[i], lon: lons[i], savedPlaceId: saved[i] }))
		);
	const validStops =
		stops.success &&
		lats.length === names.length &&
		lons.length === names.length &&
		(saved.length === 0 || saved.length === names.length);
	const object = formObject(data);
	if (object && 'when' in object && !('precision' in object) && !('dateMode' in object)) {
		const choice = object.when;
		object.precision = choice === 'month' || choice === 'year' ? choice : 'day';
		object.dateMode = object.precision === 'day' ? choice! : 'date';
		delete object.when;
	}
	if (object && 'cycleUnit' in object && !('frequency' in object) && !('repeat' in object)) {
		object.frequency = object.cycleUnit!;
		delete object.cycleUnit;
		if (object.occasionType === 'anniversary' || object.occasionType === 'birthday') {
			object.interval = '1';
			object.repeat = 'yearly';
		} else {
			object.repeat = 'custom';
		}
	}
	const parsed = eventFormSchema.safeParse(object);
	if (parsed.success && validStops)
		return {
			ok: true as const,
			values: parsed.data,
			places: stops.data.filter((row) => row.place || row.lat || row.savedPlaceId)
		};
	const values = { ...emptyEventForm };
	for (const key of Object.keys(values) as (keyof EventForm)[]) {
		const text = object?.[key];
		// Enum values fall back if invalid, rather than adding attacker-chosen options to the form.
		if (typeof text === 'string' && typeof emptyEventForm[key] === 'string') {
			const enumValues: Partial<Record<keyof EventForm, readonly string[]>> = {
				kind: ['moment', 'plan', 'occasion'],
				repeat: ['yearly', 'monthly', 'custom'],
				frequency: FREQUENCIES,
				occasionType: OCCASION_TYPES,
				dateMode: ['date', 'timed', 'undated'],
				precision: ['day', 'month', 'year'],
				category: ['none', 'trip', 'date', 'milestone'],
				disambiguation: ['reject', 'earlier', 'later'],
				endDisambiguation: ['reject', 'earlier', 'later']
			};
			if (key === 'savedPlaceId' && !eventId.safeParse(text).success) continue;
			if (!enumValues[key] || enumValues[key]!.includes(text))
				Object.assign(values, { [key]: text.slice(0, key === 'notes' ? 20000 : 200) });
		}
	}
	return {
		ok: false as const,
		places,
		values,
		fields: [
			...new Set(parsed.error?.issues.map((issue) => String(issue.path[0] ?? ''))),
			...(!validStops ? ['places'] : [])
		]
	};
}

export function handleEventError(cause: unknown): never {
	if (cause instanceof EventError && cause.code === 'not_found') error(404, 'not_found');
	throw cause;
}
