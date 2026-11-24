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
		`${resolve('/memories/albums/[id]', { id: data.album.id })}?page=${page}`;
</script>

<svelte:head><title>{data.album.title}</title></svelte:head>
<a href={resolve('/memories?view=albums')}>{m.memory.backToAlbums}</a>
<header class="heading">
	<h1>{data.album.title}</h1>
	<!-- The query is appended to a resolved route. -->
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a class="button" href={resolve('/memories/new') + `?album=${data.album.id}`}
		>{m.memory.addMedia}</a
	>
</header>
<details open={form?.problem === 'invalid'}>
	<summary>{m.memory.rename}</summary>
	<form method="POST" action="?/rename">
		<Field
			name="title"
			label={m.memory.albumName}
			maxlength={120}
			required
			value={data.album.title}
		/>
		<Button type="submit">{m.memory.save}</Button>
	</form>
</details>
<MemoryGrid rows={data.rows} {m} />
<MemoryPagination page={data.page} hasNext={data.hasNext} url={pageUrl} {m} />
{#if form?.problem === 'wrong_password'}<p role="alert">{m.error.wrongPassword}</p>
{:else if form?.problem === 'rate_limited'}<p role="alert">{m.error.rateLimited(form.minutes)}</p>
{:else if form?.problem}<p role="alert">{m.error.form}</p>{/if}

<details>
	<summary>{m.memory.albumDelete}</summary>
	<p>{m.memory.albumDeleteHint}</p>
	<form method="POST" action="?/delete">
		<Field
			name="currentPassword"
			type="password"
			label={m.field.currentPassword}
			autocomplete="current-password"
			maxlength={256}
			required
		/>
		<Button type="submit" variant="secondary">{m.memory.albumDelete}</Button>
	</form>
</details>

<style>
	.heading {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		justify-content: space-between;
		align-items: baseline;
	}
	h1 {
		overflow-wrap: anywhere;
	}
	details {
		margin-block: 1.4rem;
	}
	summary {
		cursor: pointer;
	}
</style>
