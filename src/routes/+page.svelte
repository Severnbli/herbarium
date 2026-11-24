<script lang="ts">
	import { resolve } from '$app/paths';
	import MemoryGrid from '#lib/components/MemoryGrid.svelte';
	import Ornament from '#lib/components/Ornament.svelte';
	import { formatDateOnly } from '#lib/i18n/format.ts';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const relative = $derived(new Intl.RelativeTimeFormat(data.locale, { numeric: 'auto' }));
	const elapsed = $derived(
		new Intl.NumberFormat(data.locale, { style: 'unit', unit: 'day', unitDisplay: 'long' })
	);
</script>

<div class="dashboard-header">
	<div>
		<time datetime={data.today}>{formatDateOnly(data.locale, data.today)}</time>
		<h1>{m.home.greeting(data.displayName)}</h1>
	</div>
	<a class="button" href={resolve('/events/new?kind=plan')}>{m.event.newPlan}</a>
</div>

<div class="dashboard-grid">
	<section class="panel upcoming" aria-labelledby="upcoming-title">
		<div class="section-heading">
			<h2 id="upcoming-title">{m.home.upcoming}</h2>
			<a class="button quiet" href={resolve('/calendar')}>{m.calendar.title}</a>
		</div>
		{#if data.upcoming.length}
			<ul class="events">
				{#each data.upcoming as item (item.id)}
					<li>
						<div>
							<a class="event-title record-link" href={resolve('/events/[id]', { id: item.id })}
								>{item.title}</a
							>
							<div class="event-date">
								{item.label}{#if item.countLabel}
									· {item.countLabel}{/if}
							</div>
						</div>
						{#if item.days !== null}
							<span class="countdown">{relative.format(item.days, 'day')}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p>{m.home.upcomingEmpty}</p>
		{/if}
		<div class="planning-links">
			<a class="button quiet" href={resolve('/plans')}>{m.nav.plans}</a>
			<a class="button quiet" href={resolve('/plans?view=ideas')}>{m.event.undatedPlans}</a>
		</div>
	</section>

	<section class="panel anniversary" aria-labelledby="anniversary-title">
		<div class="section-heading">
			<h2 id="anniversary-title">{m.home.anniversary}</h2>
		</div>
		{#if data.nextAnniversary}
			{@const item = data.nextAnniversary}
			<p class="anniversary-title">
				<a class="record-link" href={resolve('/events/[id]', { id: item.id })}>{item.title}</a>
			</p>
			<p class="event-date">
				{item.label}{#if item.countLabel}
					· {item.countLabel}{/if}
			</p>
			{#if item.days !== null}
				<p class="countdown">{relative.format(item.days, 'day')}</p>
			{/if}
		{:else}
			<p>{m.home.anniversaryEmpty}</p>
		{/if}
		{#if data.together}
			<div class="together">
				<div>
					<h3>{m.home.together}</h3>
					<p class="elapsed">{elapsed.format(data.together.days)}</p>
					<p class="event-date">{m.home.since(formatDateOnly(data.locale, data.together.since))}</p>
				</div>
				<div class="specimen"><Ornament /></div>
			</div>
		{/if}
	</section>

	<section class="panel history" aria-labelledby="history-title">
		<div class="section-heading">
			<h2 id="history-title">{m.home.history}</h2>
			<a class="button quiet" href={resolve('/timeline')}>{m.timeline.title}</a>
		</div>
		{#if data.onThisDay.length}
			<ul class="events">
				{#each data.onThisDay as item (item.id)}
					<li>
						<div>
							<a class="event-title record-link" href={resolve('/events/[id]', { id: item.id })}
								>{item.title}</a
							>
							<div class="event-date">{item.label}</div>
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<p>{m.home.historyEmpty}</p>
		{/if}
		<div class="planning-links">
			<a class="button quiet" href={resolve('/events')}>{m.nav.events}</a>
			<a class="button quiet" href={resolve('/events/new?kind=moment')}>{m.event.newTitle}</a>
		</div>
	</section>
</div>

<section class="panel recent" aria-labelledby="recent-title">
	<div class="section-heading">
		<h2 id="recent-title">{m.home.recent}</h2>
		<a class="button quiet" href={resolve('/memories')}>{m.memory.gallery}</a>
	</div>
	<MemoryGrid rows={data.memories} {m} />
	<a class="button quiet" href={resolve('/memories/new')}>{m.memory.addMedia}</a>
</section>

<style>
	.dashboard-header,
	.section-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem 1rem;
	}
	.dashboard-header {
		align-items: end;
		margin-bottom: clamp(1.5rem, 4vw, 2.5rem);
	}
	.dashboard-header time {
		color: var(--moss);
	}
	h1 {
		margin: 0.2rem 0 0;
		overflow-wrap: anywhere;
	}
	.dashboard-grid {
		display: grid;
		grid-template-columns: minmax(0, 5fr) minmax(0, 4fr);
		grid-template-areas: 'upcoming anniversary' 'upcoming history';
		grid-template-rows: auto 1fr;
		gap: 1rem;
	}
	.panel {
		margin: 0;
		padding: clamp(1rem, 3vw, 1.5rem);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.section-heading {
		margin-bottom: 0.85rem;
	}
	.section-heading h2 {
		margin: 0;
	}
	.panel p:last-child {
		margin-bottom: 0;
	}
	.planning-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		margin-top: 1rem;
		padding-top: 0.8rem;
		border-top: 1px solid var(--line);
	}
	.upcoming {
		grid-area: upcoming;
		border-top: 3px solid var(--moss);
	}
	.anniversary {
		grid-area: anniversary;
		border-top: 3px solid var(--madder);
		background: var(--linen);
	}
	.history {
		grid-area: history;
		border-top: 3px solid var(--flax);
	}
	.recent {
		margin-top: 1rem;
		border-top: 3px solid var(--cornflower);
	}
	.events {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.events li {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem 1rem;
		padding-block: 0.85rem;
		border-top: 1px solid var(--line);
	}
	.events li:last-child {
		padding-bottom: 0;
	}
	.event-title {
		font-weight: 600;
	}
	.event-date {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.countdown {
		width: fit-content;
		max-width: 100%;
		padding: 0.15rem 0.65rem;
		border: 1px solid var(--moss);
		border-radius: 1rem;
		color: var(--moss);
		font-size: 0.85rem;
	}
	.events .countdown {
		flex-shrink: 0;
		max-width: 45%;
	}
	.anniversary-title,
	.elapsed {
		font-family:
			Herbarium Serif,
			serif;
		font-size: clamp(1.35rem, 3vw, 1.8rem);
		line-height: 1.3;
		margin: 0.15rem 0;
	}
	.anniversary .event-date {
		margin: 0.3rem 0;
	}
	.together {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		border-top: 1px solid var(--line);
		margin-top: 1.25rem;
		padding-top: 1rem;
	}
	.together h3 {
		margin: 0;
		font-size: 1rem;
	}
	.specimen {
		flex-shrink: 0;
	}
	.specimen :global(svg) {
		margin: 0;
	}
	@media (max-width: 50rem) {
		.dashboard-grid {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto;
			grid-template-areas: 'upcoming' 'anniversary' 'history';
		}
	}
	@media (max-width: 23rem) {
		.events li {
			flex-wrap: wrap;
		}
		.events .countdown {
			max-width: 100%;
		}
		.specimen {
			display: none;
		}
	}
</style>
