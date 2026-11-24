<script lang="ts">
	import { resolve } from '$app/paths';
	import CollectionNav from '#lib/components/CollectionNav.svelte';
	import Ornament from '#lib/components/Ornament.svelte';
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

<svelte:head><title>{data.event?.title ?? m.memory.title}</title></svelte:head>
{#if data.event}
	<a href={resolve('/memories')}>{m.memory.back}</a>
{/if}
<header class="heading">
	<div>
		<h1>{data.event?.title ?? m.memory.title}</h1>
		{#if data.event}
			<a href={resolve('/events/[id]', { id: data.event.id })}>{m.memory.event}</a>
		{:else}
			<p>{m.memory.galleryIntro}</p>
		{/if}
	</div>
	{#if data.view === 'gallery'}
		<div class="gallery-actions">
			<a
				class="button"
				href={data.event
					? resolve(`/memories/new?event=${data.event.id}`)
					: resolve('/memories/new')}>{m.memory.addMedia}</a
			>
			{#if !data.event}
				<a class="button secondary" href={resolve('/memories/import')}>{m.mediaImport.bulk}</a>
			{/if}
		</div>
	{/if}
</header>
{#if !data.event}
	<CollectionNav
		label={m.memory.title}
		items={[
			{ title: m.memory.gallery, href: resolve('/memories'), current: data.view === 'gallery' },
			{
				title: m.memory.albums,
				href: resolve('/memories?view=albums'),
				current: data.view === 'albums'
			}
		]}
	/>
{/if}
{#if data.view === 'albums'}
	{#if data.albums.length}
		<ul class="albums">
			{#each data.albums as album (album.id)}
				<li>
					<a href={resolve('/memories/albums/[id]', { id: album.id })}>
						{#if album.coverId}
							<img
								loading="lazy"
								decoding="async"
								alt=""
								src={resolve('/media/[id]/[variant]', { id: album.coverId, variant: 'thumbnail' })}
							/>
						{:else}
							<span class="album-placeholder"><Ornament /></span>
						{/if}
						<span>{album.title}</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<p>{m.memory.emptyAlbums}</p>
	{/if}
	{#if form?.problem}<p role="alert">{m.error.form}</p>{/if}
	<form class="create-album" method="POST" action="?/createAlbum&view=albums">
		<Field name="title" label={m.memory.albumName} maxlength={120} required />
		<Button type="submit">{m.memory.createAlbum}</Button>
	</form>
{:else}
	<MemoryGrid rows={data.rows} groups={data.groups} {m} spacious />
	<MemoryPagination page={data.page} hasNext={data.hasNext} url={pageUrl} {m} />
{/if}

<style>
	.heading,
	.gallery-actions,
	.create-album {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.75rem;
	}
	.heading {
		justify-content: space-between;
	}
	.heading h1,
	.heading p {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.heading p {
		color: var(--muted);
	}
	.albums {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 13rem), 1fr));
		gap: 1rem;
		padding: 0;
		list-style: none;
	}
	.albums a {
		display: grid;
		height: 100%;
		align-content: start;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		color: var(--ink);
		text-decoration: none;
		font-weight: 600;
	}
	.albums a:hover {
		border-color: var(--control-line);
		background: var(--linen);
	}
	.albums a > span:last-child {
		padding: 0.7rem 0.85rem;
	}
	.albums img,
	.album-placeholder {
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
		object-fit: cover;
		background: var(--linen);
	}
	.album-placeholder {
		display: grid;
		place-items: center;
	}
	.create-album {
		align-items: end;
		padding: 1rem;
		background: var(--linen);
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.create-album :global(.field),
	.create-album :global(button) {
		margin-block: 0;
	}
</style>
