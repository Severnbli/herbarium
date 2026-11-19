import { describe, expect, it } from 'vitest';
import { parseForm } from '../auth/schemas.ts';
import { emptyEventForm, eventFormSchema, eventFilters } from './schemas.ts';
const valid = { ...emptyEventForm, title: 'A walk', start: '2024-02-29' };
describe('event validation', () => {
	it('accepts date-only, approximate and timed inputs', () => {
		expect(eventFormSchema.parse(valid).start).toBe('2024-02-29');
		expect(
			eventFormSchema.safeParse({ ...valid, precision: 'month', start: '2024-02' }).success
		).toBe(true);
		expect(
			eventFormSchema.safeParse({
				...valid,
				dateMode: 'timed',
				start: '2026-01-01T10:00',
				end: '2026-01-01T11:00',
				timeZone: 'Europe/Minsk'
			}).success
		).toBe(true);
	});
	it.each([
		{ start: '2023-02-29' },
		{ end: '2020-01-01' },
		{ title: ' ' },
		{ title: 'x'.repeat(201) },
		{ notes: 'x'.repeat(20001) },
		{ lat: '91', lon: '0' },
		{ lat: '0', lon: '181' },
		{ lat: '1', lon: '' },
		{ lat: 'NaN', lon: '0' },
		{ lat: '1e1', lon: '0' },
		{ createdBy: 'someone-else' },
		{ kind: 'occasion', precision: 'month', start: '2026-01' },
		{ kind: 'occasion', repeat: 'monthly', occasionType: 'anniversary' },
		{ kind: 'occasion', repeat: 'custom', interval: '100' },
		{ dateMode: 'timed', start: '2026-03-08T02:30', timeZone: 'America/New_York' },
		{ dateMode: 'timed', start: '2026-11-01T01:30', timeZone: 'America/New_York' },
		{ dateMode: 'timed', start: '2026-01-01T10:00', timeZone: 'Invalid' },
		{ dateMode: 'timed', start: '2026-01-01T10:00', end: '2026-01-01T10:00' },
		{ dateMode: 'timed', precision: 'year', start: '2026-01-01T10:00' }
	])('rejects invalid fields %j', (change) => {
		expect(eventFormSchema.safeParse({ ...valid, ...change }).success).toBe(false);
	});
	it('accepts coordinate limits and both sides of a repeated hour', () => {
		expect(eventFormSchema.safeParse({ ...valid, lat: '-90', lon: '180' }).success).toBe(true);
		expect(
			eventFormSchema.safeParse({
				...valid,
				dateMode: 'timed',
				start: '2026-11-01T01:30',
				end: '2026-11-01T01:30',
				timeZone: 'America/New_York',
				disambiguation: 'earlier',
				endDisambiguation: 'later'
			}).success
		).toBe(true);
	});
	it('rejects repeated fields and files', () => {
		const data = new FormData();
		for (const [key, value] of Object.entries(valid)) data.set(key, value);
		data.append('title', 'second');
		expect(parseForm(eventFormSchema, data).success).toBe(false);
		data.set('title', new Blob(['x']), 'x.txt');
		expect(parseForm(eventFormSchema, data).success).toBe(false);
	});
	it('limits filters and rejects unknown query fields', () => {
		expect(eventFilters.safeParse({ kind: 'plan', year: '2024', page: '2' }).success).toBe(true);
		for (const input of [
			{ year: '0000' },
			{ year: 'x' },
			{ page: '-1' },
			{ page: '1000000' },
			{ sort: 'title' },
			{ kind: "' OR 1=1" }
		])
			expect(eventFilters.safeParse(input).success).toBe(false);
	});
});
