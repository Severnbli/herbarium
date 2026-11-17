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
		{#if titleHref}<a href={titleHref}>{title}</a>{:else}{title}{/if}
	</h2>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{@render children()}
	{#if label}<footer>{label}</footer>{/if}
</article>

<style>
	article {
		min-width: 0;
		overflow-wrap: anywhere;
		padding: 1.5rem;
		border: 1px solid var(--line);
		background: var(--paper);
		box-shadow: var(--shadow);
	}
	h2 {
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
