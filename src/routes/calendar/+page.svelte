<script lang="ts">
	import { resolve } from '$app/paths';
	import { formatDateOnly } from '#lib/i18n/format.ts';
	import { messages } from '#lib/i18n/index.ts';
	import CollectionNav from '#lib/components/CollectionNav.svelte';
	import Field from '#lib/components/Field.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const views = ['month', 'week', 'day'] as const;
	const format = (date: string, options: Intl.DateTimeFormatOptions) =>
		new Intl.DateTimeFormat(data.locale, { ...options, timeZone: 'UTC' }).format(
			new Date(`${date}T00:00:00Z`)
		);
	const period = $derived(
		data.view === 'month'
			? format(data.date, { month: 'long', year: 'numeric' })
			: data.view === 'week'
				? `${formatDateOnly(data.locale, data.first)} – ${formatDateOnly(data.locale, data.last)}`
				: formatDateOnly(data.locale, data.date)
	);
</script>

<svelte:head><title>{m.calendar.title}</title></svelte:head>
<h1>{m.calendar.title}</h1>
<CollectionNav
	label={m.calendar.views}
	items={views.map((view) => ({
		href: resolve(`/calendar?view=${view}&date=${data.date}`),
		title: m.calendar[view],
		current: data.view === view
	}))}
/>
<div class="period">
	<h2>{period}</h2>
	<nav class="controls" aria-label={m.calendar.navigation}>
		{#if data.previous}
			<a class="button quiet" href={resolve(`/calendar?view=${data.view}&date=${data.previous}`)}
				>{m.calendar.previous}</a
			>
		{/if}
		<a class="button quiet" href={resolve(`/calendar?view=${data.view}&date=${data.today}`)}
			>{m.calendar.today}</a
		>
		{#if data.next}
			<a class="button quiet" href={resolve(`/calendar?view=${data.view}&date=${data.next}`)}
				>{m.calendar.next}</a
			>
		{/if}
	</nav>
</div>

<form method="GET" class="jump">
	<input type="hidden" name="view" value={data.view} />
	<Field name="date" type="date" label={m.calendar.jump} value={data.date} required />
	<button class="secondary">{m.calendar.go}</button>
</form>

<div class="grid" class:single={data.view === 'day'}>
	{#each data.weekdays as label (label)}
		<div class="weekday" aria-hidden="true">{label}</div>
	{/each}
	{#each data.days as date, index (index)}
		{#if date}
			{@const items = data.entries.filter((entry) => entry.date <= date && entry.end >= date)}
			<section
				class="cell"
				class:today={date === data.today}
				class:spill={data.view === 'month' && date.slice(0, 7) !== data.date.slice(0, 7)}
				aria-label={formatDateOnly(data.locale, date)}
			>
				<div class="cell-heading">
					<time datetime={date} aria-current={date === data.today ? 'date' : undefined}>
						<span class="day-number">{format(date, { day: 'numeric' })}</span>
						<span class="full-date"
							>{format(date, { weekday: 'long', day: 'numeric', month: 'long' })}</span
						>
					</time>
					<a
						class="create"
						href={resolve(`/events/new?date=${date}`)}
						aria-label={m.calendar.createOn(formatDateOnly(data.locale, date))}>+</a
					>
				</div>
				{#if items.length}
					<ul>
						{#each items as entry (`${entry.id}:${entry.date}`)}
							<li class={entry.kind}>
								<a href={resolve('/events/[id]', { id: entry.id })}>
									{#if entry.time && entry.date === date}
										<span class="entry-detail">{entry.time}</span>
									{/if}
									{entry.title}
									{#if entry.label || entry.occasionCount}
										<span class="entry-detail">{entry.label ?? entry.occasionCount}</span>
									{/if}
								</a>
							</li>
						{/each}
					</ul>
				{:else if data.view === 'day'}
					<p>{m.calendar.empty}</p>
				{/if}
			</section>
		{:else}
			<div class="blank"></div>
		{/if}
	{/each}
</div>

<style>
	h1,
	h2 {
		margin: 0;
	}
	.period,
	.controls,
	.jump,
	.cell-heading {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
	}
	.period,
	.cell-heading {
		justify-content: space-between;
	}
	.create {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
	}
	.period {
		margin-top: 0.75rem;
	}
	.jump {
		align-items: end;
		margin-block: 0.55rem 1rem;
	}
	.jump :global(.field),
	.jump button {
		margin: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 1px;
		background: var(--line);
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.grid.single {
		grid-template-columns: minmax(0, 1fr);
	}
	.weekday,
	.cell,
	.blank {
		background: var(--paper);
		padding: 0.4rem;
	}
	.weekday {
		text-align: center;
		font-weight: bold;
		background: var(--linen);
	}
	.cell {
		margin: 0;
		border: 0;
		min-height: 6rem;
		min-width: 0;
	}
	.cell.spill {
		background: var(--linen);
	}
	.cell.today {
		box-shadow: inset 0 0 0 2px var(--madder);
	}
	.cell.today time {
		color: var(--madder);
		font-weight: bold;
	}
	.cell-heading {
		gap: 0;
		padding-inline-start: 0.3rem;
	}
	.create {
		justify-content: center;
		width: 2.75rem;
		font-size: 1.4rem;
		border-radius: var(--radius);
		text-decoration: none;
	}
	.create:hover {
		background: var(--linen);
	}
	.full-date,
	.single .day-number {
		display: none;
	}
	.single .full-date {
		display: inline;
	}
	ul {
		display: grid;
		gap: 0.3rem;
		list-style: none;
		padding: 0;
		margin: 0;
	}
	li {
		border-inline-start: 2px solid var(--moss);
		padding: 0.1rem 0.3rem;
		font-size: 0.875rem;
	}
	li.plan {
		border-color: var(--cornflower);
	}
	li.occasion {
		border-color: var(--madder);
	}
	li a {
		display: block;
		color: var(--ink);
		overflow-wrap: anywhere;
	}
	.entry-detail {
		display: block;
		color: var(--muted);
		font-size: 0.8rem;
	}
	@media (max-width: 52rem) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.weekday,
		.blank,
		.cell.spill,
		.day-number {
			display: none;
		}
		.full-date {
			display: inline;
		}
		.cell {
			min-height: auto;
		}
	}
</style>
