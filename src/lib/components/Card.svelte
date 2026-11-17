<script lang="ts">
	import type { Snippet } from 'svelte';
	import Ornament from './Ornament.svelte';
	let { title, label, children }: { title: string; label?: string; children: Snippet } = $props();
	const id = $props.id();
</script>

<article aria-labelledby={id}>
	<Ornament kind="frame" />
	<h2 {id}>{title}</h2>
	{@render children()}
	{#if label}<footer>{label}</footer>{/if}
</article>

<style>
	article {
		padding: 1.5rem;
		border: 1px solid var(--line);
		background: var(--paper);
		box-shadow: var(--shadow);
	}
	footer {
		margin-top: 1rem;
		border-top: 1px solid var(--line);
		padding-top: 0.75rem;
		font-family:
			Herbarium Serif,
			serif;
		color: var(--muted);
	}
</style>
