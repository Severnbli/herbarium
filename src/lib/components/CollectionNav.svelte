<script lang="ts">
	let {
		label,
		items
	}: { label: string; items: { title: string; href: string; current: boolean }[] } = $props();
</script>

<nav aria-label={label}>
	{#each items as item (item.href)}
		<!-- The caller supplies resolved URLs. -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a href={item.href} aria-current={item.current ? 'page' : undefined}>{item.title}</a>
	{/each}
</nav>

<style>
	nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.75rem;
		border-block-end: 1px solid var(--line);
		margin-block: 1.25rem;
	}
	a {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding-inline: 0.65rem;
		border-block-end: 2px solid transparent;
		color: var(--muted);
		text-decoration: none;
	}
	a:hover {
		text-decoration: underline;
	}
	a[aria-current='page'] {
		border-color: var(--cornflower);
		color: var(--ink);
		font-weight: 650;
	}
</style>
