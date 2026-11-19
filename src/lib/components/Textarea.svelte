<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	let {
		name,
		label,
		hint,
		error,
		value = $bindable(''),
		...attributes
	}: HTMLTextareaAttributes & {
		name: string;
		label: string;
		hint?: string;
		error?: string;
	} = $props();
	const id = $props.id();
</script>

<div class="field">
	<label for={id}>{label}</label>
	<textarea
		{id}
		{name}
		bind:value
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={hint || error ? `${id}-help` : undefined}
		{...attributes}></textarea>
	{#if hint || error}<p id="{id}-help" class:error={!!error} class="hint">{error ?? hint}</p>{/if}
</div>

<style>
	.field {
		display: grid;
		gap: 0.3rem;
		margin-block: 1rem;
	}
	p {
		margin: 0;
		font-size: 0.875rem;
	}
</style>
