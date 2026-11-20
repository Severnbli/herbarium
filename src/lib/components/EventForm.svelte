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
		eventId?: string;
		values: EventForm;
		fields?: string[];
		problem?: string;
		submitLabel: string;
		cancelHref: string;
	} = $props();
	let mounted = $state(false);
	let kind = $state<string>(untrack(() => values.kind));
	let mode = $state<string>(untrack(() => values.dateMode));
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
				if (event.currentTarget.value !== 'plan' && mode === 'undated') mode = 'date';
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
			name="dateMode"
			label={m.event.dateMode}
			bind:value={mode}
			aria-invalid={invalid.has('dateMode')}
			aria-describedby={invalid.has('dateMode') || !mounted || kind === 'plan'
				? 'event-date-hint'
				: undefined}
			options={[
				{ value: 'date', label: m.event.dateOnly },
				{ value: 'timed', label: m.event.timed },
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
			<Select
				name="precision"
				label={m.design.precision}
				value={values.precision}
				aria-invalid={invalid.has('precision')}
				options={['day', 'month', 'year'].map((value) => ({
					value,
					label: m.design[value as 'day' | 'month' | 'year']
				}))}
			/>
			<Field
				name="start"
				label={m.event.start}
				value={values.start}
				error={errorFor('start')}
				hint={m.event.dateHint}
				required={mounted && mode !== 'undated'}
				maxlength={32}
			/>
			<Field
				name="end"
				label={m.event.end}
				value={values.end}
				error={errorFor('end')}
				hint={m.event.endHint}
				maxlength={32}
			/>
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
		<p>{m.event.recurrenceHint}</p>
		<Select
			name="repeat"
			label={m.event.repeat}
			value={values.repeat}
			options={(['yearly', 'monthly', 'custom'] as const).map((value) => ({
				value,
				label: m.event[value]
			}))}
		/>
		<Select
			name="frequency"
			label={m.event.frequency}
			value={values.frequency}
			options={(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const).map((value) => ({
				value,
				label: m.event[value]
			}))}
		/>
		<Field
			name="interval"
			label={m.event.interval}
			value={values.interval}
			inputmode="numeric"
			maxlength={2}
			pattern="[1-9][0-9]?"
			error={errorFor('interval')}
		/>
		<Select
			name="occasionType"
			label={m.event.occasionType}
			value={values.occasionType}
			aria-invalid={invalid.has('occasionType')}
			options={(['general', 'anniversary', 'birthday'] as const).map((value) => ({
				value,
				label: m.event[value]
			}))}
		/>
	</details>
	<fieldset id="event-place">
		<legend>{m.map.location}</legend>
		{#key values}
			<LocationPicker
				{m}
				{locale}
				{basemap}
				{eventId}
				initial={values}
				latError={errorFor('lat')}
				lonError={errorFor('lon')}
				placeError={errorFor('place')}
			/>
		{/key}
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
