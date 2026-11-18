<script lang="ts">
	import type { Messages } from '#lib/i18n/catalog.ts';

	let {
		page,
		hasNext,
		url,
		m
	}: { page: number; hasNext: boolean; url: (page: number) => string; m: Messages } = $props();
</script>

<!-- Both destinations use the resolved gallery URL and a validated page number. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
{#if page > 1 || hasNext}
	<nav aria-label={m.memory.title}>
		{#if page > 1}<a href={url(page - 1)}>{m.event.previous}</a>{/if}
		{#if hasNext}<a href={url(page + 1)}>{m.event.next}</a>{/if}
	</nav>
{/if}

<!-- eslint-enable svelte/no-navigation-without-resolve -->

<style>
	nav {
		display: flex;
		gap: 1rem;
		margin-block: 1rem;
	}
</style>
