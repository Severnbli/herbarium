<script lang="ts">
	import { resolve } from '$app/paths';
	import CollectionNav from '#lib/components/CollectionNav.svelte';
	import Ornament from '#lib/components/Ornament.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const { filters } = $derived(data);
	const tabs = $derived(
		filters.view === 'all'
			? (['all', 'scheduled', 'ideas', 'review'] as const)
			: (['scheduled', 'ideas', 'review'] as const)
	);
	const pageUrl = (page: number) =>
		resolve(`/plans?${new URLSearchParams({ ...filters, page: String(page) })}`);
</script>

<svelte:head><title>{m.nav.plans}</title></svelte:head>
<header>
	<div>
		<h1>{m.nav.plans}</h1>
		<p>{m.plans.intro}</p>
	</div>
	<a class="button" href={resolve('/events/new?kind=plan')}>{m.event.newPlan}</a>
</header>

<CollectionNav
	label={m.nav.plans}
	items={tabs.map((view) => ({
		title: view === 'all' ? m.event.all : m.plans[view],
		href:
			view === 'all'
				? pageUrl(1)
				: view === 'scheduled'
					? resolve('/plans')
					: resolve(`/plans?view=${view}`),
		current: filters.view === view
	}))}
/>
{#if filters.year}
	<p>{m.plans.year(filters.year)} · <a href={resolve('/plans')}>{m.event.clearFilters}</a></p>
{/if}
{#if data.rows.length}
	<ul class="plans">
		{#each data.rows as plan (plan.id)}
			<li>
				<div>
					<h2><a href={resolve('/events/[id]', { id: plan.id })}>{plan.title}</a></h2>
					{#if !plan.undated || filters.view === 'all'}<p>{plan.dateLabel}</p>{/if}
					{#if plan.place}<p>{plan.place}</p>{/if}
				</div>
				{#if plan.undated}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a class="row-action" href={resolve('/events/[id]/edit', { id: plan.id }) + '#event-date'}
						>{m.event.schedule}</a
					>
				{:else if filters.view === 'review'}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a class="row-action" href={resolve('/events/[id]', { id: plan.id }) + '#plan-review'}
						>{m.plans.reviewAction}</a
					>
				{/if}
			</li>
		{/each}
	</ul>
{:else}
	<div class="empty">
		<Ornament />
		<p>{m.plans.empty[filters.view]}</p>
	</div>
{/if}
{#if data.pages > 1}
	<nav aria-label={m.event.page(data.page, data.pages)}>
		{#if data.page > 1}<a href={pageUrl(data.page - 1)}>{m.event.previous}</a>{/if}
		<span>{m.event.page(data.page, data.pages)}</span>
		{#if data.page < data.pages}<a href={pageUrl(data.page + 1)}>{m.event.next}</a>{/if}
	</nav>
{/if}

<style>
	header,
	li,
	nav {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.6rem 1.25rem;
	}
	header p,
	h1,
	h2,
	li p {
		margin: 0;
		overflow-wrap: anywhere;
	}
	header p,
	li p {
		color: var(--muted);
	}
	.plans {
		padding: 0;
		list-style: none;
	}
	li {
		padding: 1rem 0.9rem;
		border-block-end: 1px solid var(--line);
		border-inline-start: 3px solid var(--cornflower);
	}
	li + li {
		margin-top: 0.4rem;
	}
	li a {
		color: var(--ink);
	}
	.row-action {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		color: var(--cornflower);
	}
	.empty {
		text-align: center;
		padding: 1rem;
		background: var(--linen);
		border-radius: var(--radius);
	}
</style>
