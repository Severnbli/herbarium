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
	const pageQuery = (page: number) =>
		`${new URLSearchParams({ kind: data.filters.kind, year: data.filters.year, page: String(page) })}`;
</script>

<svelte:head><title>{m.event.listTitle}</title></svelte:head>
<div class="heading">
	<h1>{m.event.listTitle}</h1>
	<a class="button" href={resolve('/events/new')}>{m.event.newTitle}</a>
</div>
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
	<button>{m.event.filter}</button>
</form>
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
	.filters {
		margin-block: 1.5rem;
		align-items: end;
	}
	.filters :global(.field) {
		flex: 1;
		min-width: 8rem;
	}
	.filters button {
		margin-bottom: 0.75rem;
	}
	.events {
		display: grid;
		gap: 1.5rem;
	}
	.kind {
		color: var(--moss);
	}
	nav {
		margin-top: 2rem;
	}
</style>
