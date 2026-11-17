import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatDateOnly, formatDateTime, formatRelative, weekStartsOn } from './format.ts';
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

	it('keeps every translation catalog complete', () => {
		const catalog = (locale: string): Record<string, unknown> =>
			JSON.parse(
				readFileSync(new URL(`../../../messages/${locale}.json`, import.meta.url), 'utf8')
			);
		const keys = Object.keys(catalog('en')).sort();
		for (const locale of LOCALES) {
			expect(Object.keys(catalog(locale)).sort()).toEqual(keys);
			expect(JSON.stringify(catalog(locale))).not.toContain(String.fromCodePoint(0x2014));
		}
	});

	it('have the same keys in every locale', () => {
		const keys = collect(messages('en')).sort();
		for (const locale of LOCALES) expect(collect(messages(locale)).sort()).toEqual(keys);
	});

	it('never use the em dash', () => {
		for (const locale of LOCALES) {
			expect(JSON.stringify(messages(locale))).not.toContain(String.fromCodePoint(0x2014));
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

describe('calendar formatting', () => {
	it('preserves date-only values and rejects impossible dates', () => {
		expect(formatDateOnly('en', '2024-02-29')).toBe('February 29, 2024');
		expect(formatDateOnly('ru', '2024-02-29')).toContain('29 февраля');
		expect(formatDateOnly('be', '2024-02-29')).toContain('29 лютага');
		expect(() => formatDateOnly('en', '2023-02-29')).toThrow(RangeError);
		expect(() => formatDateOnly('en', '2024-2-9')).toThrow(RangeError);
	});
	it('formats instants in the specified time zone', () => {
		const instant = Date.parse('2026-01-01T01:00:00Z');
		expect(formatDateTime('en', instant, 'America/New_York')).toContain('December 31, 2025');
		expect(formatDateTime('en', instant, 'Europe/Minsk')).toContain('January 1, 2026');
	});
	it('starts Belarusian and Russian weeks on Monday and English weeks on Sunday', () => {
		expect(weekStartsOn('be')).toBe(1);
		expect(weekStartsOn('ru')).toBe(1);
		expect(weekStartsOn('en')).toBe(0);
	});
	it('keeps independently created catalogs isolated', () => {
		const be = messages('be');
		const en = messages('en');
		expect(be.home.greeting('Alice')).toBe('Вітаем, Alice.');
		expect(en.home.greeting('Alice')).toBe('Welcome, Alice.');
		expect(be.home.greeting('Bob')).toBe('Вітаем, Bob.');
	});
});
