<script lang="ts">
	import Field from './Field.svelte';
	import Textarea from './Textarea.svelte';
	import Select from './Select.svelte';
	import Button from './Button.svelte';
	import type { Messages } from '#lib/i18n/catalog.ts';
	import type { EventForm } from '#lib/server/events/schemas.ts';
	let {
		m,
		values,
		fields = [],
		problem,
		submitLabel,
		cancelHref
	}: {
		m: Messages;
		values: EventForm;
		fields?: string[];
		problem?: string;
		submitLabel: string;
		cancelHref: string;
	} = $props();
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
<form method="POST">
	<Select
		name="kind"
		label={m.event.kind}
		value={values.kind}
		aria-invalid={invalid.has('kind')}
		options={[
			{ value: 'moment', label: m.event.moment },
			{ value: 'plan', label: m.event.plan }
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
	<fieldset>
		<legend>{m.event.dateMode}</legend>
		<Select
			name="dateMode"
			label={m.event.dateMode}
			value={values.dateMode}
			options={[
				{ value: 'date', label: m.event.dateOnly },
				{ value: 'timed', label: m.event.timed }
			]}
		/>
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
			required
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
	</fieldset>
	<Field
		name="place"
		label={m.event.place}
		value={values.place}
		error={errorFor('place')}
		maxlength={200}
	/>
	<details open={invalid.has('lat') || invalid.has('lon')}>
		<summary>{m.event.coordinatesHint}</summary>
		<Field
			name="lat"
			label={m.event.lat}
			value={values.lat}
			inputmode="decimal"
			error={errorFor('lat')}
			maxlength={32}
		/>
		<Field
			name="lon"
			label={m.event.lon}
			value={values.lon}
			inputmode="decimal"
			error={errorFor('lon')}
			maxlength={32}
		/>
	</details>
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
		margin-block: 1.5rem;
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
