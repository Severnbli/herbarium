<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import MediaUploadQueue from '#lib/components/MediaUploadQueue.svelte';
	import { mediaAccept } from '#lib/media/import-client.ts';
	import MapCanvas from '#lib/components/MapCanvas.svelte';
	import Field from '#lib/components/Field.svelte';
	import Textarea from '#lib/components/Textarea.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const size = $derived(
		new Intl.NumberFormat(data.locale, {
			style: 'unit',
			unit: 'megabyte',
			unitDisplay: 'short',
			maximumSignificantDigits: 5
		}).format(data.maxFileBytes / 1_000_000)
	);
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});
	const destination = $derived(data.target.kind === 'gallery' ? m.memory.title : data.target.title);
	const destinationHref = $derived(
		data.target.kind === 'event'
			? resolve('/events/[id]', { id: data.target.id })
			: data.target.kind === 'album'
				? resolve('/memories/albums/[id]', { id: data.target.id })
				: resolve('/memories')
	);
	const endpoint = $derived(
		resolve('/memories/new/upload') +
			(data.target.kind === 'gallery'
				? ''
				: `?${new URLSearchParams({ [data.target.kind]: data.target.id })}`)
	);
</script>

<svelte:head><title>{m.memory.addMedia}</title></svelte:head>
<h1>{m.memory.addMedia}</h1>
<p class="destination">{m.memory.destination(destination)}</p>
{#if form?.suggestion}
	{@const suggestion = form.suggestion}
	<section aria-labelledby="suggestion-title">
		<h2 id="suggestion-title">{m.memory.gpsTitle}</h2>
		<p>{m.memory.gpsHint}</p>
		<p>
			{new Intl.NumberFormat(data.locale, { maximumFractionDigits: 6 }).format(suggestion.lat)},
			{new Intl.NumberFormat(data.locale, { maximumFractionDigits: 6 }).format(suggestion.lon)}
		</p>
		<MapCanvas locale={data.locale} {m} basemap={data.basemap} position={suggestion} />
		<!-- The action suffix targets the resolved memory page. -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<form method="POST" action={`${resolve('/memories/[id]', { id: suggestion.id })}?/coordinates`}>
			<input type="hidden" name="token" value={suggestion.token} />
			<Button type="submit">{m.memory.gpsAccept}</Button>
		</form>
		<a href={resolve('/memories/[id]', { id: suggestion.id })}>{m.memory.gpsSkip}</a>
	</section>
{:else}
	{#if mounted}
		<section class="upload-panel" aria-label={m.memory.addMedia}>
			{#key endpoint}
				<MediaUploadQueue
					{m}
					locale={data.locale}
					basemap={data.basemap}
					{endpoint}
					maxFileBytes={data.maxFileBytes}
					formatHint={m.memory.formats(size)}
				/>
			{/key}
		</section>
	{/if}
	{#if mounted}
		<details open={!!form?.problem}>
			<summary>{m.memory.singleUpload}</summary>
			{@render singleUpload()}
		</details>
	{:else}
		{@render singleUpload()}
	{/if}
{/if}
<p><a href={destinationHref}>{m.memory.return(destination)}</a></p>

{#snippet singleUpload()}
	{#if form?.problem}<p role="alert">
			{form.problem === 'invalid' ? m.error.form : m.memory[form.problem]}
		</p>{/if}
	<form method="POST" enctype="multipart/form-data">
		<Field
			name="file"
			type="file"
			label={m.memory.file}
			hint={m.memory.formats(size)}
			accept={mediaAccept}
			required
		/>
		<Field name="altText" label={m.memory.altText} hint={m.memory.altHint} maxlength={280} />
		<Textarea name="caption" label={m.memory.caption} maxlength={1000} rows={3} />
		<Button type="submit">{m.memory.uploadSubmit}</Button>
	</form>
{/snippet}

<style>
	h1 {
		margin-bottom: 0.25rem;
	}
	.destination {
		margin-top: 0;
		overflow-wrap: anywhere;
		color: var(--muted);
	}
	.upload-panel {
		padding: clamp(0.85rem, 4vw, 1.5rem);
		background: var(--linen);
		border: 1px solid var(--line);
		border-top: 3px solid var(--cornflower);
		border-radius: var(--radius);
	}
	details {
		margin-block: 1rem;
	}
</style>
