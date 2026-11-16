<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends HTMLInputAttributes {
		name: string;
		/** Needed when the same field name appears in several forms on one page. */
		id?: string;
		label: string;
		hint?: string;
		error?: string | null;
	}

	let { name, id: givenId, label, hint, error, type = 'text', ...rest }: Props = $props();

	const id = $derived(givenId ?? `field-${name}`);
	const describedBy = $derived(
		[hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
			undefined
	);
</script>

<!-- A labelled input with its hint and error wired up for assistive technology. -->
<div class="field">
	<label for={id}>{label}</label>
	<input
		{id}
		{name}
		{type}
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={describedBy}
		{...rest}
	/>
	{#if hint}
		<p class="hint" id="{id}-hint">{hint}</p>
	{/if}
	{#if error}
		<p class="error" id="{id}-error">{error}</p>
	{/if}
</div>

<style>
	.field {
		display: grid;
		gap: 0.25rem;
		margin-block: 0.75rem;
	}

	.hint,
	.error {
		margin: 0;
		font-size: 0.875rem;
	}

	.error {
		font-weight: bold;
	}
</style>
