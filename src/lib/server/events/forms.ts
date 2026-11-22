import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { formObject } from '../auth/schemas.ts';
import {
	emptyEventForm,
	eventFormSchema,
	placeFields,
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
	const columns = ['extra-place', 'extra-lat', 'extra-lon'].map((key) => {
		const values = data.getAll(key);
		data.delete(key);
		return values;
	});
	const [names, lats, lons] = columns;
	const places = names!.slice(0, 100).map((place, i) => ({
		place: typeof place === 'string' ? place.slice(0, 200) : '',
		lat: String(lats![i] ?? '').slice(0, 32),
		lon: String(lons![i] ?? '').slice(0, 32)
	}));
	const stops = z
		.array(placeFields)
		.max(100)
		.safeParse(names!.map((place, i) => ({ place, lat: lats![i], lon: lons![i] })));
	const validStops = stops.success && columns.every((column) => column.length === names!.length);
	const object = formObject(data);
	const parsed = eventFormSchema.safeParse(object);
	if (parsed.success && validStops)
		return {
			ok: true as const,
			values: parsed.data,
			places: stops.data.filter((row) => row.place || row.lat)
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
