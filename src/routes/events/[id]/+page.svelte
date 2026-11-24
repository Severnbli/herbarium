<script lang="ts">
	import { resolve } from '$app/paths';
	import DeleteConfirmation from '#lib/components/DeleteConfirmation.svelte';
	import Button from '#lib/components/Button.svelte';
	import MapCanvas from '#lib/components/MapCanvas.svelte';
	import MemoryGrid from '#lib/components/MemoryGrid.svelte';
	import { REMINDER_OFFSETS } from '#lib/domain/reminder.ts';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const edit = $derived(resolve('/events/[id]/edit', { id: data.event.id }));
	const pins = $derived(
		[data.event, ...data.places].flatMap((stop, index) =>
			stop.lat === null || stop.lon === null
				? []
				: [
						{
							id: data.event.id,
							pinId: String(index),
							kind: data.event.kind,
							title: data.event.title,
							place: stop.place,
							date: data.dateLabel,
							lat: stop.lat,
							lon: stop.lon,
							preview: null
						}
					]
		)
	);
	const undated = $derived(data.event.dateMode === 'undated');
</script>

<svelte:head><title>{data.event.title}</title></svelte:head>
<a
	href={resolve(
		data.planContext
			? undated
				? '/plans?view=ideas'
				: data.canComplete
					? '/plans?view=review'
					: '/plans'
			: '/events'
	)}
>
	{data.planContext ? m.event.backToPlans : m.event.back}
</a>
<header class="event-header" class:plan={data.planContext}>
	<p class="kind">
		{m.event[data.event.kind]}{data.event.category !== 'none'
			? ` · ${m.event[data.event.category]}`
			: ''}
	</p>
	<div class="heading">
		<h1>{data.event.title}</h1>
		<a class="button secondary" href={edit}>{data.planContext ? m.plans.edit : m.event.editTitle}</a
		>
	</div>
	<p class="byline">{m.event.createdBy(data.event.createdByName)}</p>
	<div class="event-details">
		<div>
			<p>{data.dateLabel}{data.event.timeZone ? ` (${data.event.timeZone})` : ''}</p>
			<!-- The fragment targets the date fieldset on the resolved edit page. -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={edit + '#event-date'}>{undated ? m.event.schedule : m.event.changeDate}</a>
		</div>
		<div>
			{#if data.event.place}<p>{data.event.place}</p>{/if}
			{#each data.places as stop (stop.position)}<p>
					{stop.place || [stop.lat, stop.lon].join(', ')}
				</p>{/each}
			<!-- The fragment targets the place fieldset on the resolved edit page. -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={edit + '#event-place'}>
				{data.places.length || data.event.place || data.event.lat !== null
					? m.event.changePlace
					: m.event.addPlace}
			</a>
		</div>
	</div>
</header>
{#if data.canComplete || form?.problem === 'not_finished'}
	<section class="review" id="plan-review" aria-labelledby="review-title">
		<div>
			<h2 id="review-title">{m.plans.reviewTitle}</h2>
			<p>{m.plans.reviewHint}</p>
			{#if form?.problem === 'not_finished'}<p role="alert">{m.event.notFinished}</p>{/if}
		</div>
		{#if data.canComplete}
			<form method="POST" action="?/complete">
				<Button type="submit">{m.event.complete}</Button>
			</form>
		{/if}
	</section>
{/if}
{#if data.recurrence}
	<p>{m.event.recurrence}: {data.recurrence.summary}</p>
	<section aria-labelledby="upcoming-title">
		<h2 id="upcoming-title">{m.event.upcoming}</h2>
		{#if data.recurrence.upcoming.length}
			<ul>
				{#each data.recurrence.upcoming as occurrence (occurrence.date)}
					<li>{occurrence.date}{occurrence.label ? ` · ${occurrence.label}` : ''}</li>
				{/each}
			</ul>
		{:else}
			<p>{m.event.noneUpcoming}</p>
		{/if}
	</section>
{/if}
{#if data.notesHtml}
	<section aria-labelledby="notes-title">
		<h2 id="notes-title">{m.event.notes}</h2>
		<!-- The only user-content HTML exception: notes rendered and allowlist-sanitized on the server. -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		<div class="notes">{@html data.notesHtml}</div>
	</section>
{/if}
{#if form?.problem === 'invalid'}<p role="alert">
		{m.error.form}
	</p>{/if}
<section aria-labelledby="event-memories">
	<div class="heading">
		<h2 id="event-memories">{m.memory.title}</h2>
		<a
			class="button"
			class:secondary={data.planContext}
			href={resolve(`/memories/new?event=${data.event.id}`)}
		>
			{m.memory.addMedia}
		</a>
	</div>
	<!-- eslint-disable svelte/no-navigation-without-resolve -->
	<MemoryGrid rows={data.memories.rows} {m} />
	{#if data.memories.hasNext}
		<a href={`${resolve('/memories')}?event=${data.event.id}`}>{m.memory.browse}</a>
	{/if}
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
</section>
{#if pins.length}
	<section aria-labelledby="event-location">
		<h2 id="event-location">{m.map.location}</h2>
		{#each pins as pin (pin.pinId)}<p>
				{pin.place ? pin.place + ' · ' : ''}{m.event.lat}: {pin.lat}, {m.event.lon}: {pin.lon}
			</p>{/each}
		<MapCanvas
			locale={data.locale}
			{m}
			basemap={data.basemap}
			entries={pins.length > 1 ? pins : undefined}
			position={pins.length === 1 ? pins[0] : null}
		/>
	</section>
{/if}
<section id="event-reminders" aria-labelledby="reminder-heading">
	<details
		open={!!form?.reminderProblem ||
			(!undated && data.event.precision === 'day' && data.reminderOffsets.length > 0)}
	>
		<summary id="reminder-heading">{m.reminder.title}</summary>
		{#if !undated && data.event.precision === 'day'}
			<p>{m.reminder.sharedHint}</p>
			{#if form?.reminderProblem}<p role="alert">{m.error.form}</p>{/if}
			<form method="POST" action="?/reminders">
				<div class="reminder-offsets">
					{#each REMINDER_OFFSETS as { field, minutes } (field)}
						<label>
							<input
								type="checkbox"
								name={field}
								checked={data.reminderOffsets.includes(minutes)}
							/>
							{m.reminder[field]}
						</label>
					{/each}
				</div>
				<Button type="submit" variant="secondary">{m.reminder.saveOffsets}</Button>
			</form>
		{:else}
			<p>{m.reminder.preciseOnly}</p>
		{/if}
	</details>
</section>
<DeleteConfirmation
	label={data.planContext ? m.plans.delete : m.event.deleteTitle}
	description={data.planContext ? m.plans.deleteHint : m.event.deleteHint}
	error={form?.deleteProblem ? m.error.form : undefined}
/>

<style>
	summary {
		cursor: pointer;
		font-weight: 600;
	}

	.event-header {
		margin-block: 1rem 1.75rem;
		padding: clamp(1rem, 4vw, 1.75rem);
		background: var(--linen);
		border: 1px solid var(--line);
		border-top: 3px solid var(--madder);
		border-radius: var(--radius);
	}
	.event-header.plan,
	.review {
		border-block-start-color: var(--cornflower);
	}
	.review {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem 1rem;
		margin-block: 0 1.75rem;
		padding: 1rem;
		border: 1px solid var(--line);
		border-inline-start: 3px solid var(--cornflower);
		border-radius: var(--radius);
	}
	.review h2,
	.review p,
	.review form :global(button) {
		margin: 0;
	}
	.heading,
	.event-details {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 1.25rem;
		row-gap: 0.5rem;
	}
	.heading {
		justify-content: space-between;
	}
	.event-details {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--line);
	}
	.event-details p,
	.heading h2,
	.kind,
	.byline {
		margin: 0;
	}
	.kind {
		color: var(--moss);
	}
	.byline,
	.event-details a {
		font-size: 0.9rem;
	}
	.byline {
		color: var(--muted);
	}
	.reminder-offsets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		margin-bottom: 0.75rem;
	}
	.reminder-offsets label {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	p {
		overflow-wrap: anywhere;
	}
	h1 {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.notes {
		overflow-wrap: anywhere;
	}
</style>
