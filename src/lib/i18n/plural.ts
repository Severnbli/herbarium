export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

/** Picks the plural form for `count` with the locale's CLDR rules, never `count === 1` logic. */
export function plural(locale: string, count: number, forms: PluralForms): string {
	const rule = new Intl.PluralRules(locale).select(count);
	return (forms[rule] ?? forms.other).replaceAll('#', String(count));
}
