export { messages, type Messages } from './catalog.ts';

export const LOCALES = ['be', 'ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
	return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Picks the best supported locale from an `Accept-Language` header. */
export function negotiateLocale(header: string | null | undefined): Locale {
	if (!header) return DEFAULT_LOCALE;
	const ranked = header
		.split(',')
		.slice(0, 20)
		.map((part, index) => {
			const [tag = '', ...params] = part.trim().split(';');
			const q = params.map((param) => /^\s*q=([\d.]+)\s*$/.exec(param)?.[1]).find(Boolean);
			return { tag: tag.toLowerCase(), q: q === undefined ? 1 : Number(q), index };
		})
		.filter((entry) => entry.q > 0 && !Number.isNaN(entry.q))
		.sort((a, b) => b.q - a.q || a.index - b.index);
	for (const { tag } of ranked) {
		const base = tag.split('-')[0];
		if (isLocale(base)) return base;
	}
	return DEFAULT_LOCALE;
}
