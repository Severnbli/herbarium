import { describe, expect, it } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { parseEventForm, routeEventId } from './forms.ts';
import { emptyEventForm } from './schemas.ts';
const form = (values: Record<string, string>) => {
	const data = new FormData();
	for (const [key, value] of Object.entries(values)) data.set(key, value);
	return data;
};
describe('event route inputs', () => {
	it('accepts only random URL identifiers', () => {
		expect(routeEventId({ id: 'a'.repeat(22) })).toBe('a'.repeat(22));
		for (const params of [{ id: '../secret' }, { id: 'a'.repeat(22), other: 'value' }, {}]) {
			let caught: unknown;
			try {
				routeEventId(params);
			} catch (cause) {
				caught = cause;
			}
			expect(isHttpError(caught, 404)).toBe(true);
		}
	});
	it('preserves bounded known values and never reflects unknown sensitive fields', () => {
		const result = parseEventForm(
			form({
				...emptyEventForm,
				title: 'Synthetic title',
				start: '2023-02-29',
				currentPassword: 'never return this'
			})
		);
		expect(result.ok).toBe(false);
		expect(result.values.title).toBe('Synthetic title');
		expect(result.values.start).toBe('2023-02-29');
		expect(result.values).not.toHaveProperty('currentPassword');
		const large = parseEventForm(
			form({ ...emptyEventForm, notes: 'x'.repeat(30000), kind: 'bad' })
		);
		expect(large.values.notes).toHaveLength(20000);
		expect(large.values.kind).toBe('moment');
	});
	it('rejects duplicate fields instead of choosing one', () => {
		const data = form({ ...emptyEventForm, title: 'Synthetic', start: '2024-01-01' });
		data.append('title', 'second');
		expect(parseEventForm(data).ok).toBe(false);
	});
	it('identifies an invalid end and time zone', () => {
		const result = parseEventForm(
			form({ ...emptyEventForm, title: 'Synthetic', start: '2024-01-01', end: '2024-02-30' })
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.fields).toContain('end');
		const zone = parseEventForm(
			form({
				...emptyEventForm,
				title: 'Synthetic',
				dateMode: 'timed',
				start: '2024-01-01T12:00',
				timeZone: 'Invalid'
			})
		);
		expect(zone.ok).toBe(false);
		if (!zone.ok) expect(zone.fields).toContain('timeZone');
	});
});
