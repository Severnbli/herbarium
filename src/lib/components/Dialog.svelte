<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		open = $bindable(false),
		title,
		closeLabel,
		children
	}: { open?: boolean; title: string; closeLabel: string; children: Snippet } = $props();
	let dialog: HTMLDialogElement;
	const id = $props.id();
	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	aria-labelledby={id}
	onclose={() => {
		open = false;
	}}
>
	<h2 {id}>{title}</h2>
	{@render children()}
	<button
		type="button"
		onclick={() => {
			open = false;
		}}>{closeLabel}</button
	>
</dialog>

<style>
	dialog {
		color: var(--ink);
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 2rem;
		max-width: min(36rem, calc(100% - 2rem));
		max-height: 90dvh;
	}
	dialog::backdrop {
		background: #0009;
	}
</style>
