<script lang="ts">
	import type { HTMLSelectAttributes } from 'svelte/elements';
	let {
		name,
		label,
		options,
		value = $bindable(''),
		...attributes
	}: Omit<HTMLSelectAttributes, 'children'> & {
		name: string;
		label: string;
		options: { value: string; label: string }[];
	} = $props();
	const id = $props.id();
</script>

<div class="field">
	<label for={id}>{label}</label>
	<select {id} {name} bind:value {...attributes}>
		{#each options as option (option.value)}<option value={option.value}>{option.label}</option
			>{/each}
	</select>
</div>

<style>
	.field {
		display: grid;
		gap: 0.3rem;
		margin-block: 1rem;
	}
</style>
