import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { formObject } from '../auth/schemas.ts';
import { emptyEventForm, eventFormSchema, eventId, type EventForm } from './schemas.ts';
import { EventError } from './events.ts';

export function routeEventId(params: Record<string, string | undefined>): string {
	const parsed = z.strictObject({ id: eventId }).safeParse(params);
	if (!parsed.success) error(404, 'not_found');
	return parsed.data.id;
}

/** Reflect only known, bounded text values; never include a password or uploaded file. */
export function parseEventForm(data: FormData) {
	const object = formObject(data);
	const parsed = eventFormSchema.safeParse(object);
	if (parsed.success) return { ok: true as const, values: parsed.data };
	const values = { ...emptyEventForm };
	for (const key of Object.keys(values) as (keyof EventForm)[]) {
		const text = object?.[key];
		// Enum values fall back if invalid, rather than adding attacker-chosen options to the form.
		if (typeof text === 'string' && typeof emptyEventForm[key] === 'string') {
			const enumValues: Partial<Record<keyof EventForm, readonly string[]>> = {
				kind: ['moment', 'plan'],
				dateMode: ['date', 'timed'],
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
		values,
		fields: [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '')))]
	};
}

export function handleEventError(cause: unknown): never {
	if (cause instanceof EventError && cause.code === 'not_found') error(404, 'not_found');
	throw cause;
}
