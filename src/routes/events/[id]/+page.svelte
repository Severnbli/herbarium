<script lang="ts">
	import { resolve } from '$app/paths';
	import Field from '#lib/components/Field.svelte';
	import Button from '#lib/components/Button.svelte';
	import MapCanvas from '#lib/components/MapCanvas.svelte';
	import MemoryGrid from '#lib/components/MemoryGrid.svelte';
	import { REMINDER_OFFSETS } from '#lib/domain/reminder.ts';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const edit = $derived(resolve('/events/[id]/edit', { id: data.event.id }));
	const undated = $derived(data.event.dateMode === 'undated');
</script>

<svelte:head><title>{data.event.title}</title></svelte:head>
<a href={resolve('/events')}>{m.event.back}</a>
<header class="event-header">
	<p class="kind">
		{m.event[data.event.kind]}{data.event.category !== 'none'
			? ` · ${m.event[data.event.category]}`
			: ''}
	</p>
	<div class="heading">
		<h1>{data.event.title}</h1>
		<a class="button secondary" href={edit}>{m.event.editTitle}</a>
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
			<!-- The fragment targets the place fieldset on the resolved edit page. -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={edit + '#event-place'}>
				{data.event.place || data.event.lat !== null ? m.event.changePlace : m.event.addPlace}
			</a>
		</div>
	</div>
</header>
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
{#if form?.problem === 'not_finished'}<p role="alert">{m.event.notFinished}</p>
{:else if form?.problem === 'invalid' && !form?.deleteProblem}<p role="alert">
		{m.error.form}
	</p>{/if}
<section aria-labelledby="event-memories">
	<div class="heading">
		<h2 id="event-memories">{m.memory.title}</h2>
		<!-- The query is appended to a resolved route. -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a class="button" href={resolve('/memories/new') + `?event=${data.event.id}`}>
			{m.memory.addMedia}
		</a>
	</div>
	<!-- eslint-disable svelte/no-navigation-without-resolve -->
	<MemoryGrid rows={data.memories.rows} locale={data.locale} {m} />
	{#if data.memories.hasNext}
		<a href={`${resolve('/memories')}?event=${data.event.id}`}>{m.memory.browse}</a>
	{/if}
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
</section>
{#if data.event.kind === 'plan' && !undated}
	<section>
		<form method="POST" action="?/complete">
			<Button type="submit" disabled={!data.canComplete}>{m.event.complete}</Button>
		</form>
		{#if !data.canComplete}<p>{m.event.notFinished}</p>{/if}
	</section>
{/if}
{#if data.event.lat !== null && data.event.lon !== null}
	<section aria-labelledby="event-location">
		<h2 id="event-location">{m.map.location}</h2>
		<p>{m.event.lat}: {data.event.lat}, {m.event.lon}: {data.event.lon}</p>
		<MapCanvas
			locale={data.locale}
			{m}
			basemap={data.basemap}
			position={{ lat: data.event.lat, lon: data.event.lon }}
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
<section>
	<details open={!!form?.deleteProblem}>
		<summary>{m.event.deleteTitle}</summary>
		<p>{m.event.deleteHint}</p>
		{#if form?.deleteProblem}
			{#if form.problem === 'wrong_password'}<p role="alert">{m.error.wrongPassword}</p>
			{:else if form.problem === 'rate_limited'}<p role="alert">
					{m.error.rateLimited(form.minutes)}
				</p>
			{:else}<p role="alert">{m.error.form}</p>{/if}
		{/if}
		<form method="POST" action="?/delete">
			<Field
				name="currentPassword"
				type="password"
				label={m.field.currentPassword}
				autocomplete="current-password"
				required
				maxlength={256}
			/>
			<Button type="submit" variant="secondary">{m.event.delete}</Button>
		</form>
	</details>
</section>

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
