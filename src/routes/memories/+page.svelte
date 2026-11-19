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
<div class="heading">
	<h1>{m.memory.title}</h1>
	<!-- eslint-disable svelte/no-navigation-without-resolve -->
	<a
		class="button"
		href={`${resolve('/memories/new')}${data.event ? `?event=${data.event.id}` : ''}`}
		>{m.memory.upload}</a
	>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{#if !data.event}
		<a class="button secondary" href={resolve('/memories/import')}>{m.mediaImport.title}</a>
	{/if}
</div>
<MemoryGrid rows={data.rows} locale={data.locale} {m} />
<MemoryPagination page={data.page} hasNext={data.hasNext} url={pageUrl} {m} />
{#if !data.event}
	<section aria-labelledby="albums">
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
	li {
		overflow-wrap: anywhere;
	}
</style>
