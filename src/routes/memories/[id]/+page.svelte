<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Field from '#lib/components/Field.svelte';
	import MemoryPreview from '#lib/components/MemoryPreview.svelte';
	import Select from '#lib/components/Select.svelte';
	import Textarea from '#lib/components/Textarea.svelte';
	import { formatDateOnly } from '#lib/i18n/format.ts';
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
<p>
	<time datetime={row.sortDate}>{formatDateOnly(data.locale, row.sortDate)}</time> · {m.event.createdBy(
		row.createdByName
	)}
</p>
{#if row.eventId}<p>
		<a href={resolve('/events/[id]', { id: row.eventId })}>{row.eventTitle}</a>
	</p>{/if}
<!-- The query selects attachment disposition on the resolved original endpoint. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
<a
	class="button"
	href={`${resolve('/media/[id]/[variant]', { id: row.id, variant: 'original' })}?download=1`}
	>{m.memory.download}</a
>
<!-- eslint-enable svelte/no-navigation-without-resolve -->

{#if form?.problem === 'coordinates'}<p role="alert">{m.memory.coordinates}</p>
{:else if form?.problem === 'wrong_password'}<p role="alert">{m.error.wrongPassword}</p>
{:else if form?.problem === 'rate_limited'}<p role="alert">{m.error.rateLimited(form.minutes)}</p>
{:else if form?.problem}<p role="alert">{m.error.form}</p>{/if}

<details>
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
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a href={`${resolve('/memories')}#albums`}>{m.memory.createAlbum}</a>
	{/if}
</section>
<details>
	<summary>{m.memory.delete}</summary>
	<p>{m.memory.deleteHint}</p>
	<form method="POST" action="?/delete">
		<Field
			name="currentPassword"
			type="password"
			label={m.field.currentPassword}
			autocomplete="current-password"
			maxlength={256}
			required
		/>
		<Button type="submit" variant="secondary">{m.memory.delete}</Button>
	</form>
</details>

<style>
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
	.membership {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
		align-items: center;
		margin-block: 0.4rem;
	}
</style>
