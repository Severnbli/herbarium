<script lang="ts">
	import { resolve } from '$app/paths';
	import DeleteConfirmation from '#lib/components/DeleteConfirmation.svelte';
	import Button from '#lib/components/Button.svelte';
	import Field from '#lib/components/Field.svelte';
	import MemoryPreview from '#lib/components/MemoryPreview.svelte';
	import Select from '#lib/components/Select.svelte';
	import Textarea from '#lib/components/Textarea.svelte';
	import { formatDateOnly, formatDateTime } from '#lib/i18n/format.ts';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const row = $derived(data.memory);
	const included = $derived(data.albums.filter((album) => album.containsMemory));
	const available = $derived(data.albums.filter((album) => !album.containsMemory));
</script>

<svelte:head><title>{row.originalName}</title></svelte:head>
<a href={resolve('/memories')}>{m.memory.back}</a>
<h1>{row.originalName}</h1>
<MemoryPreview memory={row} {m} />
{#if row.caption}<p class="caption">{row.caption}</p>{/if}
<dl class="file-dates">
	{#if row.captureDate}<dt>{m.memory.captured}</dt>
		<dd>
			<time datetime={row.captureDate}>{formatDateOnly(data.locale, row.captureDate)}</time>
		</dd>{/if}
	<dt>{m.memory.uploadedOn}</dt>
	<dd>
		<time datetime={row.uploadedAt.toISOString()}
			>{formatDateTime(data.locale, row.uploadedAt, data.timeZone)}</time
		>
		· {m.event.createdBy(row.createdByName)}
	</dd>
</dl>
<!-- The query selects attachment disposition on the resolved original endpoint. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
<a
	class="button"
	href={`${resolve('/media/[id]/[variant]', { id: row.id, variant: 'original' })}?download=1`}
	>{m.memory.download}</a
>
<!-- eslint-enable svelte/no-navigation-without-resolve -->

{#if form?.problem === 'coordinates'}<p role="alert">{m.memory.coordinates}</p>
{:else if form?.problem}<p role="alert">{m.error.form}</p>{/if}

<details class="edit-panel">
	<summary>{m.memory.description}</summary>
	<form method="POST" action="?/description">
		<Field
			name="altText"
			label={m.memory.altText}
			hint={m.memory.altHint}
			maxlength={280}
			value={row.altText}
		/>
		<Textarea
			name="caption"
			label={m.memory.caption}
			maxlength={1000}
			rows={3}
			value={row.caption}
		/>
		<Button type="submit">{m.memory.save}</Button>
	</form>
</details>
<section class="edit-panel" aria-labelledby="linked-event">
	<h2 id="linked-event">{m.memory.event}</h2>
	{#if row.eventId}
		<a href={resolve('/events/[id]', { id: row.eventId })}>{row.eventTitle}</a>
	{/if}
	<details open={!!data.search || !!form?.eventProblem}>
		<summary>{m.memory.changeEventLink}</summary>
		<form method="GET" action={resolve('/memories/[id]', { id: row.id })}>
			<Field
				name="q"
				type="search"
				label={m.memory.eventSearch}
				value={data.search}
				maxlength={200}
			/>
			<Button type="submit" variant="secondary">{m.event.filter}</Button>
		</form>
		{#if data.search && !data.events.length}<p>{m.memory.noMatchingEvents}</p>{/if}
		<form
			method="POST"
			action={`?/event${data.search ? '&' + new URLSearchParams({ q: data.search }) : ''}`}
		>
			{#if form?.eventProblem}<p role="alert">{m.error.form}</p>{/if}
			<Select
				name="eventId"
				label={m.memory.event}
				value={row.eventId ?? ''}
				options={[
					{ value: '', label: m.memory.noEvent },
					...(row.eventId && row.eventTitle ? [{ value: row.eventId, label: row.eventTitle }] : []),
					...data.events.map(({ id, title }) => ({ value: id, label: title }))
				]}
			/>
			<Button type="submit" variant="secondary">{m.memory.saveEvent}</Button>
		</form>
	</details>
</section>
<section aria-labelledby="memory-albums">
	<h2 id="memory-albums">{m.memory.albums}</h2>
	{#if included.length}
		<ul>
			{#each included as album (album.id)}
				<li>
					<form method="POST" action="?/album" class="membership">
						<a href={resolve('/memories/albums/[id]', { id: album.id })}>{album.title}</a>
						<input type="hidden" name="albumId" value={album.id} />
						<input type="hidden" name="operation" value="remove" />
						<Button
							type="submit"
							variant="secondary"
							aria-label={`${m.memory.albumRemove}: ${album.title}`}>{m.memory.albumRemove}</Button
						>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
	{#if available.length}
		<form method="POST" action="?/album">
			<Select
				name="albumId"
				label={m.memory.albumName}
				options={available.map((album) => ({ value: album.id, label: album.title }))}
				value={available[0]?.id}
				required
			/>
			<input type="hidden" name="operation" value="add" />
			<Button type="submit">{m.memory.albumAdd}</Button>
		</form>
	{:else if !included.length}
		<a href={resolve('/memories?view=albums')}>{m.memory.createAlbum}</a>
	{/if}
</section>
<DeleteConfirmation
	label={m.memory.delete}
	description={m.memory.deleteHint}
	error={form?.deleteProblem ? m.error.form : undefined}
/>

<style>
	.file-dates {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.25rem 1rem;
	}
	.file-dates dt {
		color: var(--muted);
	}
	.file-dates dd {
		margin: 0;
	}
	h1,
	p,
	li {
		overflow-wrap: anywhere;
	}
	.caption {
		white-space: pre-wrap;
	}
	details {
		margin-block: 1.4rem;
	}
	summary {
		cursor: pointer;
	}
	.edit-panel {
		padding: clamp(0.75rem, 4vw, 1.25rem);
		background: var(--linen);
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.edit-panel h2 {
		margin-top: 0;
	}
	.membership {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		align-items: center;
		margin-block: 0.4rem;
	}
</style>
