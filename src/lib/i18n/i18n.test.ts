import { describe, expect, it } from 'vitest';
import { formatRelative } from './format';
import { LOCALES, messages, negotiateLocale } from './index';

describe('negotiateLocale', () => {
	it.each([
		[null, 'en'],
		['', 'en'],
		['be-BY,be;q=0.9', 'be'],
		['de-DE,ru;q=0.8,en;q=0.5', 'ru'],
		['en;q=0.3,be;q=0.9', 'be'],
		['fr', 'en'],
		['ru;q=0', 'en']
	])('%s → %s', (header, expected) => {
		expect(negotiateLocale(header)).toBe(expected);
	});
});

describe('messages', () => {
	const collect = (value: unknown, prefix = ''): string[] =>
		typeof value === 'object' && value !== null
			? Object.entries(value).flatMap(([key, child]) => collect(child, `${prefix}${key}.`))
			: [prefix];

	it('have the same keys in every locale', () => {
		const keys = collect(messages('en')).sort();
		for (const locale of LOCALES) expect(collect(messages(locale)).sort()).toEqual(keys);
	});

	it('never use the em dash', () => {
		for (const locale of LOCALES) {
			expect(JSON.stringify(messages(locale))).not.toContain('—');
		}
	});

	it('use CLDR plural rules', () => {
		expect(messages('ru').error.rateLimited(1)).toContain('1 минуту');
		expect(messages('ru').error.rateLimited(3)).toContain('3 минуты');
		expect(messages('ru').error.rateLimited(11)).toContain('11 минут');
		expect(messages('ru').error.rateLimited(21)).toContain('21 минуту');
		expect(messages('be').error.rateLimited(2)).toContain('2 хвіліны');
		expect(messages('be').error.rateLimited(5)).toContain('5 хвілін');
		expect(messages('en').error.rateLimited(1)).toContain('1 minute');
		expect(messages('en').error.rateLimited(2)).toContain('2 minutes');
		expect(messages('be').account.recoveryLeft(1)).toBe('Застаўся 1 рэзервовы код.');
	});
});

describe('formatRelative', () => {
	const now = new Date('2026-01-10T12:00:00Z');
	it('formats past and future times per locale', () => {
		expect(formatRelative('en', new Date('2026-01-10T09:00:00Z'), now)).toBe('3 hours ago');
		expect(formatRelative('en', new Date('2026-01-17T12:00:00Z'), now)).toBe('next week');
		expect(formatRelative('ru', new Date('2026-01-16T12:00:00Z'), now)).toBe('через 6 дней');
		expect(formatRelative('en', now, now)).toBe('this minute');
	});
});
