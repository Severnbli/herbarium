<script lang="ts">
	import Select from './Select.svelte';
	import type { Messages } from '#lib/i18n/catalog.ts';
	let {
		name,
		label,
		m,
		value = $bindable(''),
		precision = $bindable<'day' | 'month' | 'year'>('day'),
		required = false
	}: {
		name: string;
		label: string;
		m: Messages;
		value?: string;
		precision?: 'day' | 'month' | 'year';
		required?: boolean;
	} = $props();
	const id = $props.id();
</script>

<fieldset>
	<legend>{label}</legend>
	<Select
		name="{name}Precision"
		label={m.design.precision}
		bind:value={precision}
		options={[
			{ value: 'day', label: m.design.day },
			{ value: 'month', label: m.design.month },
			{ value: 'year', label: m.design.year }
		]}
		onchange={() => {
			value = '';
		}}
	/>
	<label for={id}>{label}</label>
	{#if precision === 'year'}
		<input
			{id}
			{name}
			type="text"
			inputmode="numeric"
			pattern="[0-9]{4}"
			minlength="4"
			maxlength="4"
			bind:value
			{required}
		/>
	{:else if precision === 'month'}
		<input {id} {name} type="month" bind:value {required} />
	{:else}
		<input {id} {name} type="date" bind:value {required} />
	{/if}
</fieldset>
