<script lang="ts">
	import type { Snippet } from 'svelte';
	import Ornament from './Ornament.svelte';
	let {
		title,
		titleHref,
		label,
		children
	}: { title: string; titleHref?: string; label?: string; children: Snippet } = $props();
	const id = $props.id();
</script>

<article aria-labelledby={id}>
	<Ornament kind="frame" />
	<!-- titleHref is resolved by the caller, including the configured base path. -->
	<!-- eslint-disable svelte/no-navigation-without-resolve -->
	<h2 {id}>
		{#if titleHref}<a class="record-link" href={titleHref}>{title}</a>{:else}{title}{/if}
	</h2>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{@render children()}
	{#if label}<footer>{label}</footer>{/if}
</article>

<style>
	article {
		min-width: 0;
		overflow-wrap: anywhere;
		padding: clamp(0.85rem, 3vw, 1.4rem);
		border: 1px solid var(--line);
		background: var(--paper);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}
	article :global(svg) {
		margin-block: 0 0.85rem;
		height: 1.4rem;
	}
	h2 {
		margin-block: 0;
		overflow-wrap: anywhere;
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
