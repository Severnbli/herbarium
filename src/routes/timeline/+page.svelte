<script lang="ts">
	import { resolve } from '$app/paths';
	import Ornament from '#lib/components/Ornament.svelte';
	import Select from '#lib/components/Select.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const kinds = ['moment', 'plan', 'occasion'] as const;
	const categories = ['trip', 'date', 'milestone', 'none'] as const;
	const query = (position?: { newer: string } | { older: string }) =>
		new URLSearchParams({ ...data.filters, ...position }).toString();
</script>

<svelte:head><title>{m.timeline.title}</title></svelte:head>
<h1>{m.timeline.title}</h1>

<form method="GET" action={resolve('/timeline')} class="filters">
	<Select
		name="kind"
		label={m.event.kind}
		value={data.filters.kind}
		options={[
			{ value: '', label: m.event.all },
			...kinds.map((kind) => ({ value: kind, label: m.event[kind] }))
		]}
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

{#if data.years.length === 0}
	<div class="empty">
		<Ornament />
		<p>{m.timeline.empty}</p>
	</div>
{:else}
	<div class="timeline">
		{#each data.years as { year, entries } (year)}
			<section class="year" aria-labelledby={`year-${year}`}>
				<h2 id={`year-${year}`}>{Number(year)}</h2>
				<ol role="list">
					{#each entries as entry (entry.id)}
						<li class={entry.kind}>
							<span class="marker" aria-hidden="true"></span>
							<article>
								<div class="details">
									<p class="date">{entry.date}</p>
									<h3><a href={resolve('/events/[id]', { id: entry.id })}>{entry.title}</a></h3>
									<p class="kind">
										{m.event[entry.kind]}{entry.category !== 'none'
											? ` · ${m.event[entry.category]}`
											: ''}
									</p>
									{#if entry.place}<p>{entry.place}</p>{/if}
								</div>
								{#if entry.preview}
									<a class="preview" href={resolve('/memories/[id]', { id: entry.preview.id })}>
										<img
											src={resolve('/media/[id]/[variant]', {
												id: entry.preview.id,
												variant: 'thumbnail'
											})}
											alt={entry.preview.label}
											loading="lazy"
											decoding="async"
										/>
									</a>
								{/if}
							</article>
						</li>
					{/each}
				</ol>
			</section>
		{/each}
	</div>
{/if}

{#if data.newer || data.older || (data.fromCursor && !data.years.length)}
	<nav class="pagination" aria-label={m.timeline.navigation}>
		{#if data.newer}
			<a href={resolve(`/timeline?${query({ newer: data.newer })}`)}>{m.timeline.newer}</a>
		{:else if data.fromCursor && !data.years.length}
			<a href={resolve(`/timeline?${query()}`)}>{m.timeline.latest}</a>
		{/if}
		{#if data.older}
			<a class="older" href={resolve(`/timeline?${query({ older: data.older })}`)}
				>{m.timeline.older}</a
			>
		{/if}
	</nav>
{/if}

<style>
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 0.5rem 1rem;
		margin-block: 1.5rem 2.25rem;
	}
	.filters :global(.field) {
		flex: 1 1 9rem;
	}
	.filters button {
		margin-block: 0 0.75rem;
	}
	.empty {
		text-align: center;
		color: var(--muted);
	}
	.timeline {
		--stem-inset: 0.6rem;
		--branch-length: clamp(1.5rem, 5vw, 3rem);
		position: relative;
		padding-inline-start: calc(var(--stem-inset) + var(--branch-length));
	}
	.timeline::before {
		content: '';
		position: absolute;
		inset: 1rem auto 0;
		inset-inline-start: var(--stem-inset);
		width: 2px;
		background: var(--moss);
		transform-origin: bottom;
	}
	.year {
		margin: 0;
		padding: 0;
		border: 0;
	}
	.year + .year {
		margin-block-start: 2rem;
	}
	h2 {
		position: relative;
		width: fit-content;
		margin: 0 0 0.85rem;
		padding: 0.3rem 0.75rem;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		background: var(--linen);
		color: var(--moss);
		font-variant-numeric: tabular-nums;
	}
	h2::before {
		content: '';
		position: absolute;
		inset-block-start: 50%;
		inset-inline-start: calc(-1 * var(--branch-length));
		width: var(--branch-length);
		border-top: 2px solid var(--moss);
	}
	h2::after {
		content: '';
		position: absolute;
		inset-block-start: 50%;
		inset-inline-start: calc(-1 * var(--branch-length) - 0.35rem);
		width: 0.8rem;
		height: 0.8rem;
		border: 2px solid var(--moss);
		background: var(--paper);
		transform: translateY(-50%) rotate(45deg);
	}
	ol {
		display: grid;
		gap: 0.75rem;
		padding: 0;
		margin: 0;
		list-style: none;
	}
	li {
		--marker-color: var(--moss);
		position: relative;
		min-width: 0;
	}
	li.plan {
		--marker-color: var(--cornflower);
	}
	li.occasion {
		--marker-color: var(--madder);
	}
	.marker {
		position: absolute;
		inset-block-start: 1.65rem;
		inset-inline-start: calc(-1 * var(--branch-length));
		width: var(--branch-length);
		border-top: 1px solid var(--moss);
		transform-origin: left;
	}
	.marker::before {
		content: '';
		position: absolute;
		inset: -0.53rem auto auto 0.15rem;
		width: 0.95rem;
		height: 0.62rem;
		border: 1px solid var(--marker-color);
		border-radius: 0 80%;
		background: var(--marker-color);
		transform: rotate(-35deg);
	}
	.plan .marker::before {
		background: var(--paper);
	}
	.occasion .marker::before {
		inset-block-start: -0.61rem;
		width: 0.95rem;
		height: 0.95rem;
		border: 0;
		border-radius: 0;
		clip-path: polygon(
			50% 0,
			65% 25%,
			95% 25%,
			82% 50%,
			95% 75%,
			65% 75%,
			50% 100%,
			35% 75%,
			5% 75%,
			18% 50%,
			5% 25%,
			35% 25%
		);
		transform: none;
	}
	article {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem 1rem;
		padding: 0.8rem 1rem;
		border: 1px solid var(--line);
		border-inline-start: 2px solid var(--marker-color);
		border-radius: var(--radius);
		background: var(--paper);
	}
	.details {
		flex: 1 1 12rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	h3,
	p {
		margin: 0;
	}
	h3 {
		font-size: 1.15rem;
		margin-block: 0.15rem 0.3rem;
	}
	.date,
	.kind {
		font-size: 0.85rem;
		color: var(--muted);
	}
	.preview {
		display: block;
		width: min(8rem, 100%);
		border-radius: var(--radius);
	}
	.preview img {
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
		object-fit: cover;
		border-radius: inherit;
		background: var(--linen);
	}
	.pagination {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem 1.5rem;
		margin-block-start: 1.75rem;
	}
	.older {
		margin-inline-start: auto;
	}
	@media (prefers-reduced-motion: no-preference) {
		.timeline::before {
			animation: grow-stem 420ms ease-out both;
		}
		.marker {
			animation: grow-branch 240ms 160ms ease-out both;
		}
	}
	@keyframes grow-stem {
		from {
			transform: scaleY(0);
		}
	}
	@keyframes grow-branch {
		from {
			transform: scaleX(0);
		}
	}
</style>
