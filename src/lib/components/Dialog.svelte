<script lang="ts">
	import type { Snippet } from 'svelte';
	let {
		open = $bindable(false),
		title,
		closeLabel,
		wide = false,
		onkeydown,
		children
	}: {
		open?: boolean;
		title: string;
		closeLabel: string;
		wide?: boolean;
		onkeydown?: (event: KeyboardEvent) => void;
		children: Snippet;
	} = $props();
	let dialog: HTMLDialogElement;
	let closeButton: HTMLButtonElement;
	const id = $props.id();
	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) {
			dialog.showModal();
			closeButton.focus();
		} else if (!open && dialog.open) dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	aria-labelledby={id}
	class:wide
	{onkeydown}
	onclose={() => {
		open = false;
	}}
>
	<header>
		<h2 {id}>{title}</h2>
		<button
			bind:this={closeButton}
			type="button"
			onclick={() => {
				open = false;
			}}
			class="secondary">{closeLabel}</button
		>
	</header>
	{@render children()}
</dialog>

<style>
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	header h2 {
		margin: 0;
	}
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
	dialog.wide {
		width: min(60rem, calc(100% - 2rem));
		max-width: none;
		padding: clamp(0.75rem, 4vw, 2rem);
		overflow-wrap: anywhere;
	}
</style>
