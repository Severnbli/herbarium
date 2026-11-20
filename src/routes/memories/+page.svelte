<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Field from '#lib/components/Field.svelte';
	import MemoryGrid from '#lib/components/MemoryGrid.svelte';
	import MemoryPagination from '#lib/components/MemoryPagination.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const pageUrl = (page: number) =>
		`${resolve('/memories')}?${new URLSearchParams({
			page: String(page),
			...(data.event ? { event: data.event.id } : {})
		})}`;
</script>

<svelte:head><title>{m.memory.title}</title></svelte:head>
{#if data.event}
	<a href={resolve('/events/[id]', { id: data.event.id })}>{data.event.title}</a>
{/if}
<header class="heading">
	<h1>{m.memory.title}</h1>
	<a
		class="button"
		href={data.event ? resolve(`/memories/new?event=${data.event.id}`) : resolve('/memories/new')}
	>
		{m.memory.addMedia}
	</a>
</header>
{#if !data.event}
	<div class="gallery-actions">
		<a href="#albums">{m.memory.albums}</a>
		<a href={resolve('/memories/import')}>{m.mediaImport.bulk}</a>
	</div>
{/if}
<MemoryGrid rows={data.rows} locale={data.locale} {m} />
<MemoryPagination page={data.page} hasNext={data.hasNext} url={pageUrl} {m} />
{#if !data.event}
	<section class="albums" aria-labelledby="albums">
		<h2 id="albums">{m.memory.albums}</h2>
		{#if data.albums.length}
			<ul>
				{#each data.albums as album (album.id)}
					<li><a href={resolve('/memories/albums/[id]', { id: album.id })}>{album.title}</a></li>
				{/each}
			</ul>
		{/if}
		{#if form?.problem}<p role="alert">{m.error.form}</p>{/if}
		<form method="POST" action="?/createAlbum">
			<Field name="title" label={m.memory.albumName} maxlength={120} required />
			<Button type="submit">{m.memory.createAlbum}</Button>
		</form>
	</section>
{/if}

<style>
	.heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.heading h1 {
		flex: 1 1 auto;
		margin: 0;
	}

	.gallery-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem 1.1rem;
		margin-block: 0.65rem 1rem;
	}
	.albums {
		background: var(--linen);
		padding: clamp(1rem, 4vw, 1.5rem);
		border: 1px solid var(--line);
		border-top: 3px solid var(--moss);
		border-radius: var(--radius);
	}
	.albums h2 {
		margin-top: 0;
	}
	li {
		overflow-wrap: anywhere;
	}
</style>
