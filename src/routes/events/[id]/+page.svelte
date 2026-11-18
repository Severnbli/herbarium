<script lang="ts">
	import { resolve } from '$app/paths';
	import Field from '#lib/components/Field.svelte';
	import Button from '#lib/components/Button.svelte';
	import MemoryGrid from '#lib/components/MemoryGrid.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));
</script>

<svelte:head><title>{data.event.title}</title></svelte:head>
<a href={resolve('/events')}>{m.event.back}</a>
<h1>{data.event.title}</h1>
<p>
	{m.event[data.event.kind]}{data.event.category !== 'none'
		? ` · ${m.event[data.event.category]}`
		: ''}
</p>
<p>{data.dateLabel}{data.event.timeZone ? ` (${data.event.timeZone})` : ''}</p>
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
{#if data.event.place}<p>{data.event.place}</p>{/if}
{#if data.event.lat !== null && data.event.lon !== null}<p>
		{m.event.lat}: {data.event.lat}, {m.event.lon}: {data.event.lon}
	</p>{/if}
{#if data.notesHtml}
	<section aria-labelledby="notes-title">
		<h2 id="notes-title">{m.event.notes}</h2>
		<!-- The only user-content HTML exception: notes rendered and allowlist-sanitized on the server. -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		<div class="notes">{@html data.notesHtml}</div>
	</section>
{/if}
<p>{m.event.createdBy(data.event.createdByName)}</p>
<a class="button" href={resolve('/events/[id]/edit', { id: data.event.id })}>{m.event.edit}</a>
{#if form?.problem === 'not_finished'}<p role="alert">{m.event.notFinished}</p>
{:else if form?.problem === 'wrong_password'}<p role="alert">{m.error.wrongPassword}</p>
{:else if form?.problem === 'rate_limited'}<p role="alert">{m.error.rateLimited(form.minutes)}</p>
{:else if form?.problem === 'invalid'}<p role="alert">{m.error.form}</p>{/if}
{#if data.event.kind === 'plan'}
	<section>
		<form method="POST" action="?/complete">
			<Button type="submit" disabled={!data.canComplete}>{m.event.complete}</Button>
		</form>
		{#if !data.canComplete}<p>{m.event.notFinished}</p>{/if}
	</section>
{/if}
<section aria-labelledby="event-memories">
	<h2 id="event-memories">{m.memory.title}</h2>
	<!-- eslint-disable svelte/no-navigation-without-resolve -->
	<a class="button" href={`${resolve('/memories/new')}?event=${data.event.id}`}>{m.memory.upload}</a
	>
	<MemoryGrid rows={data.memories.rows} locale={data.locale} {m} />
	{#if data.memories.hasNext}
		<a href={`${resolve('/memories')}?event=${data.event.id}`}>{m.memory.browse}</a>
	{/if}
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
</section>
<section aria-labelledby="delete-title">
	<h2 id="delete-title">{m.event.deleteTitle}</h2>
	<p>{m.event.deleteHint}</p>
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
</section>

<style>
	p {
		overflow-wrap: anywhere;
	}
	h1 {
		margin-top: 1rem;
		overflow-wrap: anywhere;
	}
	.notes {
		overflow-wrap: anywhere;
	}
</style>
