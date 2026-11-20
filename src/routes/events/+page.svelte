<script lang="ts">
	import { resolve } from '$app/paths';
	import Card from '#lib/components/Card.svelte';
	import Ornament from '#lib/components/Ornament.svelte';
	import Field from '#lib/components/Field.svelte';
	import Select from '#lib/components/Select.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';
	let { data }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const filtered = $derived(!!(data.filters.kind || data.filters.year || data.filters.date));
	const pageQuery = (page: number) =>
		`${new URLSearchParams({ kind: data.filters.kind, year: data.filters.year, date: data.filters.date, page: String(page) })}`;
</script>

<svelte:head><title>{m.event.listTitle}</title></svelte:head>
<div class="heading">
	<h1>{m.event.listTitle}</h1>
	<div class="heading-actions">
		<!-- The query is appended to a resolved route. -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a class="button secondary" href={resolve('/events/new') + '?kind=plan'}>{m.event.newPlan}</a>
		<a class="button" href={resolve('/events/new')}>{m.event.newTitle}</a>
	</div>
</div>
<details class="filter-panel" open={filtered}>
	<summary>{m.event.filters}</summary>
	<form method="GET" action={resolve('/events')} class="filters">
		<Select
			name="kind"
			label={m.event.kind}
			value={data.filters.kind}
			options={[
				{ value: '', label: m.event.all },
				{ value: 'moment', label: m.event.moment },
				{ value: 'plan', label: m.event.plan },
				{ value: 'occasion', label: m.event.occasion }
			]}
		/>
		<Field
			name="year"
			label={m.event.year}
			value={data.filters.year}
			inputmode="numeric"
			pattern="[0-9]{4}"
			maxlength={4}
		/>
		<Select
			name="date"
			label={m.event.dateFilter}
			value={data.filters.date}
			options={[
				{ value: '', label: m.event.all },
				{ value: 'undated', label: m.event.undated }
			]}
		/>
		<div class="filter-actions">
			<button>{m.event.filter}</button>
			{#if filtered}<a href={resolve('/events')}>{m.event.clearFilters}</a>{/if}
		</div>
	</form>
</details>
{#if data.rows.length === 0}
	<Ornament />
	<p>{m.event.empty}</p>
{:else}
	<div class="events">
		{#each data.rows as event (event.id)}
			<Card
				title={event.title}
				titleHref={resolve('/events/[id]', { id: event.id })}
				label={m.event.createdBy(event.createdByName)}
			>
				<p class="kind">
					{m.event[event.kind]}{event.category !== 'none' ? ` · ${m.event[event.category]}` : ''}
				</p>
				<p>{event.dateLabel}</p>
				{#if event.place}<p>{event.place}</p>{/if}
			</Card>
		{/each}
	</div>
{/if}
<!-- Pagination adds validated query fields to the resolved events path. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
{#if data.pages > 1}
	<nav aria-label={m.event.listTitle}>
		{#if data.page > 1}<a href={`${resolve('/events')}?${pageQuery(data.page - 1)}`}
				>{m.event.previous}</a
			>{/if}
		<span>{m.event.page(data.page, data.pages)}</span>
		{#if data.page < data.pages}<a href={`${resolve('/events')}?${pageQuery(data.page + 1)}`}
				>{m.event.next}</a
			>{/if}
	</nav>
{/if}

<!-- eslint-enable svelte/no-navigation-without-resolve -->

<style>
	.heading,
	.heading-actions,
	.filters,
	nav {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 1rem;
		justify-content: space-between;
	}
	.heading h1 {
		margin: 0;
	}
	.filter-panel {
		margin-block: 1rem 1.5rem;
		padding: 0.65rem 0.9rem;
		background: var(--linen);
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.filter-panel summary {
		cursor: pointer;
		font-weight: 600;
	}
	.filters {
		align-items: end;
	}
	.filters :global(.field) {
		flex: 1;
		min-width: 8rem;
	}
	.filter-actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-block: 0.25rem 0.8rem;
	}
	.events {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
		gap: 1.25rem;
	}
	.kind {
		color: var(--moss);
	}
	nav {
		margin-top: 2rem;
	}
</style>
