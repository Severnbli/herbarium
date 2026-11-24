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
		gap: 0.4rem;
		width: fit-content;
		max-width: 100%;
		padding: 0.3rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--linen);
		margin-block: 1.25rem;
	}
	a {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0.35rem 0.8rem;
		border: 1px solid transparent;
		border-radius: var(--radius);
		color: var(--ink);
		text-decoration: none;
	}
	a:hover {
		border-color: var(--control-line);
		background: var(--paper);
	}
	a[aria-current='page'] {
		border-color: var(--cornflower);
		background: var(--paper);
		color: var(--cornflower);
		font-weight: 650;
		box-shadow: inset 0 -2px var(--cornflower);
	}
</style>
