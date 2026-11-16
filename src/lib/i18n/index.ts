import { be } from './messages/be.ts';
import { en, type Messages } from './messages/en.ts';
import { ru } from './messages/ru.ts';

/**
 * Minimal i18n layer until Paraglide arrives in phase 2: typed dictionaries per locale, so a
 * missing key in any locale is a type error. Components read `messages(locale)`.
 */
export const LOCALES = ['be', 'ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

const dictionaries: Record<Locale, Messages> = { be, ru, en };

export function messages(locale: Locale): Messages {
	return dictionaries[locale];
}

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

export type { Messages };
