import { Temporal } from '@js-temporal/polyfill';
import { formatEventDate, instantToLocal } from '#lib/domain/event-date.ts';
import { messages, type Locale } from '#lib/i18n/index.ts';
import { expandOccasion, readRecurrence, type RecurringEvent } from './recurrence.ts';

export function anniversarySuffix(locale: Locale, count: number) {
	if (locale !== 'en') return '';
	const ordinal = new Intl.PluralRules(locale, { type: 'ordinal' }).select(count);
	return ordinal === 'one' ? 'st' : ordinal === 'two' ? 'nd' : ordinal === 'few' ? 'rd' : 'th';
}

export function describeOccasion(locale: Locale, event: RecurringEvent, now = new Date()) {
	const m = messages(locale).event;
	const { frequency, interval } = readRecurrence(event.recurrenceRule);
	const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' } as const;
	const summary =
		interval === 1
			? m[frequency]
			: m.every(
					new Intl.NumberFormat(locale, {
						style: 'unit',
						unit: unit[frequency],
						unitDisplay: 'long'
					}).format(interval)
				);

	const today = Temporal.PlainDate.from(
		event.timeZone
			? instantToLocal(now, event.timeZone).slice(0, 10)
			: now.toISOString().slice(0, 10)
	);
	const through = today.add({ years: 1 });
	const upcoming = expandOccasion(event, today.toString(), through.toString())
		.filter(({ value }) => (value.endsAt ?? value.startsAt ?? now) >= now)
		.slice(0, 5)
		.map(({ value, count }) => {
			const number = new Intl.NumberFormat(locale).format(count);
			return {
				date: formatEventDate(locale, value),
				label:
					event.occasionType === 'birthday'
						? m.birthdayAge(number)
						: event.occasionType === 'anniversary' && count > 0
							? m.anniversaryCount(number, anniversarySuffix(locale, count))
							: null
			};
		});
	return { summary, upcoming };
}
