<script lang="ts">
	import { resolve } from '$app/paths';
	import Field from '#lib/components/Field.svelte';
	import MapCanvas from '#lib/components/MapCanvas.svelte';
	import Ornament from '#lib/components/Ornament.svelte';
	import Select from '#lib/components/Select.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const kinds = ['moment', 'plan', 'occasion'] as const;
	const categories = ['trip', 'date', 'milestone', 'none'] as const;
</script>

<svelte:head><title>{m.map.title}</title></svelte:head>
<h1>{m.map.title}</h1>

<form method="GET" action={resolve('/map')} class="filters">
	<Select
		name="kind"
		label={m.event.kind}
		value={data.filters.kind}
		options={[
			{ value: '', label: m.event.all },
			...kinds.map((kind) => ({ value: kind, label: m.event[kind] }))
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
		name="category"
		label={m.event.category}
		value={data.filters.category}
		options={[
			{ value: '', label: m.timeline.allCategories },
			...categories.map((category) => ({ value: category, label: m.event[category] }))
		]}
	/>
	<button class="secondary">{m.event.filter}</button>
</form>

<div class="map-layout">
	<MapCanvas locale={data.locale} {m} basemap={data.basemap} entries={data.entries} />
	<section aria-labelledby="pinned-places">
		<h2 id="pinned-places">{m.map.places}</h2>
		{#if data.entries.length}
			<ul role="list">
				{#each data.entries as entry (entry.id)}
					<li class={entry.kind}>
						<a href={resolve('/events/[id]', { id: entry.id })}>{entry.title}</a>
						<p>{entry.date}</p>
						{#if entry.place}<p>{entry.place}</p>{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<Ornament />
			<p>{m.map.empty}</p>
		{/if}
	</section>
</div>

<style>
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 0.5rem 1rem;
		margin-bottom: 1.25rem;
	}
	.filters :global(.field) {
		flex: 1 1 9rem;
	}
	.filters button {
		margin-block: 0 0.75rem;
	}
	.map-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(15rem, 24%);
		align-items: start;
		gap: 1.5rem;
	}
	section {
		margin: 0;
		padding: 0 0 0 1rem;
		border: 0;
		border-inline-start: 1px solid var(--line);
		max-height: clamp(23rem, 63vh, 42rem);
		overflow: auto;
	}
	h2 {
		margin-top: 0;
	}
	li {
		border-inline-start: 3px solid var(--madder);
		padding: 0.25rem 0.75rem;
	}
	li.plan {
		border-color: var(--cornflower);
	}
	li.occasion {
		border-color: var(--flax);
	}
	ul {
		padding: 0;
		list-style: none;
		display: grid;
		gap: 0.85rem;
	}
	li a {
		font-weight: bold;
	}
	li p {
		margin: 0;
		color: var(--muted);
		overflow-wrap: anywhere;
		font-size: 0.9rem;
	}
	@media (max-width: 55rem) {
		.map-layout {
			grid-template-columns: minmax(0, 1fr);
		}
		section {
			border: 0;
			border-block-start: 1px solid var(--line);
			padding: 1rem 0 0;
			max-height: none;
		}
	}
</style>
