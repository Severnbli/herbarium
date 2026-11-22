<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import Field from './Field.svelte';
	import LocationPicker from './LocationPicker.svelte';
	import Textarea from './Textarea.svelte';
	import Select from './Select.svelte';
	import Button from './Button.svelte';
	import type { Locale, Messages } from '#lib/i18n/index.ts';
	import type { EventForm } from '#lib/server/events/schemas.ts';
	let {
		m,
		locale,
		basemap,
		places = [],
		savedPlaces,
		eventId,
		values,
		fields = [],
		problem,
		submitLabel,
		cancelHref
	}: {
		m: Messages;
		locale: Locale;
		basemap: boolean;
		places?: { place: string; lat: string; lon: string }[];
		savedPlaces: { id: string; place: string; lat: number; lon: number }[];
		eventId?: string;
		values: EventForm;
		fields?: string[];
		problem?: string;
		submitLabel: string;
		cancelHref: string;
	} = $props();
	let nextKey = 0;
	let stops = $state(untrack(() => places.map((initial) => ({ key: nextKey++, initial }))));
	let occasionType = $state<string>(untrack(() => values.occasionType));
	let mounted = $state(false);
	let kind = $state<string>(untrack(() => values.kind));
	let mode = $state<string>(
		untrack(() =>
			values.dateMode === 'date' && values.precision !== 'day' ? values.precision : values.dateMode
		)
	);
	let start = $state(untrack(() => values.start));
	let end = $state(untrack(() => values.end));
	const inputType = $derived(
		!mounted
			? 'text'
			: mode === 'timed'
				? 'datetime-local'
				: mode === 'month'
					? 'month'
					: mode === 'year'
						? 'text'
						: 'date'
	);
	function changeDateType(next: string) {
		const convert = (value: string) => {
			if (!value || next === 'undated') return value;
			const date = value.slice(0, 10);
			if (next === 'year') return date.slice(0, 4);
			if (next === 'month') return date.length >= 7 ? date.slice(0, 7) : '';
			if (date.length !== 10) return '';
			return next === 'timed' ? date + 'T00:00' : date;
		};
		start = convert(start);
		end = convert(end);
		mode = next;
	}
	onMount(() => {
		mounted = true;
	});
	const invalid = $derived(new Set(fields));
	const errorFor = (name: string) => (invalid.has(name) ? m.event.invalidField : undefined);
	const folds = $derived(
		['reject', 'earlier', 'later'].map((value) => ({
			value,
			label: m.event[value as 'reject' | 'earlier' | 'later']
		}))
	);
</script>

{#if problem}<p role="alert">
		{problem === 'not_finished' ? m.event.notFinished : m.event.invalid}
	</p>{/if}
<form method="POST" action={eventId ? resolve('/events/[id]/edit', { id: eventId }) : undefined}>
	<fieldset>
		<legend>{m.event.details}</legend>
		<Select
			name="kind"
			label={m.event.kind}
			bind:value={kind}
			onchange={(event) => {
				if (
					(event.currentTarget.value !== 'plan' && mode === 'undated') ||
					(event.currentTarget.value === 'occasion' && ['month', 'year'].includes(mode))
				)
					changeDateType('date');
			}}
			aria-invalid={invalid.has('kind')}
			options={[
				{ value: 'moment', label: m.event.moment },
				{ value: 'plan', label: m.event.plan },
				{ value: 'occasion', label: m.event.occasion }
			]}
		/>
		<Field
			name="title"
			label={m.event.title}
			value={values.title}
			error={errorFor('title')}
			required
			maxlength={200}
		/>
		<Select
			name="category"
			label={m.event.category}
			value={values.category}
			options={['none', 'trip', 'date', 'milestone'].map((value) => ({
				value,
				label: m.event[value as 'none' | 'trip' | 'date' | 'milestone']
			}))}
		/>
	</fieldset>
	<fieldset id="event-date">
		<legend>{m.event.dateSection}</legend>
		<Select
			name="when"
			label={m.event.dateMode}
			value={mode}
			onchange={(e) => changeDateType(e.currentTarget.value)}
			aria-invalid={invalid.has('dateMode')}
			aria-describedby={invalid.has('dateMode') || !mounted || kind === 'plan'
				? 'event-date-hint'
				: undefined}
			options={[
				{ value: 'date', label: m.event.dateOnly },
				{ value: 'timed', label: m.event.timed },
				...(!mounted || kind !== 'occasion'
					? [
							{ value: 'month', label: m.design.month },
							{ value: 'year', label: m.design.year }
						]
					: []),
				...(!mounted || kind === 'plan' || mode === 'undated'
					? [{ value: 'undated', label: m.event.undated }]
					: [])
			]}
		/>
		{#if invalid.has('dateMode')}
			<p id="event-date-hint" class="error">{m.event.dateRequired}</p>
		{:else if !mounted || kind === 'plan'}
			<p id="event-date-hint" class="hint">{m.event.undatedHint}</p>
		{/if}
		<div class="date-fields" hidden={mounted && mode === 'undated'}>
			<Field
				name="start"
				label={m.event.start}
				type={inputType}
				value={start}
				oninput={(e) => (start = e.currentTarget.value)}
				inputmode={mounted && mode === 'year' ? 'numeric' : undefined}
				pattern={mounted && mode === 'year' ? '[0-9]{4}' : undefined}
				error={errorFor('start')}
				hint={!mounted ? m.event.dateHint : undefined}
				required={mounted && mode !== 'undated'}
				maxlength={32}
			/>
			<details open={!mounted || !!values.end || invalid.has('end')}>
				<summary>{m.event.end}</summary><Field
					name="end"
					label={m.event.end}
					type={inputType}
					value={end}
					oninput={(e) => (end = e.currentTarget.value)}
					inputmode={mounted && mode === 'year' ? 'numeric' : undefined}
					pattern={mounted && mode === 'year' ? '[0-9]{4}' : undefined}
					error={errorFor('end')}
					hint={m.event.endHint}
					maxlength={32}
				/>
			</details>
			<div hidden={mounted && mode !== 'timed'}>
				<Field
					name="timeZone"
					label={m.event.timeZone}
					value={values.timeZone}
					error={errorFor('timeZone')}
					hint={m.event.zoneHint}
					maxlength={100}
				/>
				<details open={invalid.has('start')}>
					<summary>{m.event.disambiguation}</summary>
					<p>{m.event.foldHint}</p>
					<Select
						name="disambiguation"
						label={m.event.disambiguation}
						value={values.disambiguation}
						options={folds}
					/>
					<Select
						name="endDisambiguation"
						label={m.event.endDisambiguation}
						value={values.endDisambiguation}
						options={folds}
					/>
				</details>
			</div>
		</div>
	</fieldset>
	<details
		hidden={mounted && kind !== 'occasion'}
		open={kind === 'occasion' || invalid.has('occasionType') || invalid.has('interval')}
	>
		<summary>{m.event.occasionSettings}</summary>
		<Select
			name="occasionType"
			label={m.event.occasionType}
			bind:value={occasionType}
			aria-invalid={invalid.has('occasionType')}
			options={(['general', 'anniversary', 'birthday'] as const).map((value) => ({
				value,
				label: m.event[value]
			}))}
		/>
		{#if !mounted || occasionType === 'general'}
			<div class="recurrence-fields">
				<Field
					name="interval"
					type="number"
					label={m.event.repeatEvery}
					value={values.interval}
					min={1}
					max={99}
					required
					error={errorFor('interval')}
				/>
				<Select
					name="cycleUnit"
					label={m.event.unit}
					value={values.repeat === 'custom'
						? values.frequency
						: values.repeat === 'monthly'
							? 'MONTHLY'
							: 'YEARLY'}
					options={(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const).map((value) => ({
						value,
						label: m.event.units[value]
					}))}
				/>
			</div>
		{/if}
		{#if !mounted || occasionType !== 'general'}<p>{m.event.annualHint}</p>{/if}
	</details>
	<fieldset id="event-place">
		<legend>{m.map.location}</legend>
		{#key values}
			<LocationPicker
				{m}
				{locale}
				{basemap}
				{eventId}
				{savedPlaces}
				initial={values}
				latError={errorFor('lat')}
				lonError={errorFor('lon')}
				placeError={errorFor('place')}
			/>
		{/key}
		{#each stops as stop (stop.key)}
			<div class="stop">
				<LocationPicker
					{m}
					{locale}
					{basemap}
					{savedPlaces}
					initial={stop.initial}
					extra
					latError={errorFor('places')}
				/>
				{#if mounted}<button
						class="secondary"
						type="button"
						onclick={() => (stops = stops.filter((s) => s.key !== stop.key))}>{m.map.remove}</button
					>{/if}
			</div>
		{/each}
		{#if mounted && stops.length < 100}<button
				class="secondary"
				type="button"
				onclick={() => stops.push({ key: nextKey++, initial: { place: '', lat: '', lon: '' } })}
				>{m.map.addStop}</button
			>{/if}
	</fieldset>
	<Textarea
		name="notes"
		label={m.event.notes}
		value={values.notes}
		hint={m.event.notesHint}
		error={errorFor('notes')}
		rows={7}
		maxlength={20000}
	/>
	<div class="actions">
		<Button type="submit">{submitLabel}</Button><!-- The caller supplies a resolved cancel URL. -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a href={cancelHref}>{m.event.cancel}</a>
	</div>
</form>

<style>
	.recurrence-fields {
		display: grid;
		grid-template-columns: minmax(4rem, 7rem) minmax(6rem, 1fr);
		gap: 1rem;
		align-items: baseline;
	}
	.stop {
		border-block-start: 1px solid var(--line);
		padding-block: 1rem;
	}
	fieldset {
		min-width: 0;
		margin-block: 1.25rem;
		padding: 0.5rem clamp(0.85rem, 4vw, 1.5rem);
		background: var(--linen);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		scroll-margin-top: 1rem;
	}
	legend {
		padding-inline: 0.45rem;
		font-weight: 650;
	}
	.hint {
		color: var(--muted);
	}
	details {
		margin-block: 1rem;
	}
	summary {
		cursor: pointer;
		color: var(--muted);
	}
	.actions {
		display: flex;
		gap: 1.5rem;
		flex-wrap: wrap;
		align-items: center;
	}
</style>
