<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
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
	const eventHref = $derived(data.event ? resolve('/events/[id]', { id: data.event.id }) : null);
</script>

<svelte:head><title>{m.memory.upload}</title></svelte:head>
{#if data.event && eventHref}
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a href={eventHref}>{data.event.title}</a>
{:else}
	<a href={resolve('/memories')}>{m.memory.back}</a>
{/if}
<h1>{m.memory.upload}</h1>
{#if form?.suggestion}
	{@const suggestion = form.suggestion}
	<section aria-labelledby="suggestion-title">
		<h2 id="suggestion-title">{m.memory.gpsTitle}</h2>
		<p>{m.memory.gpsHint}</p>
		<p>
			{new Intl.NumberFormat(data.locale, { maximumFractionDigits: 6 }).format(suggestion.lat)},
			{new Intl.NumberFormat(data.locale, { maximumFractionDigits: 6 }).format(suggestion.lon)}
		</p>
		<MapCanvas locale={data.locale} {m} basemap={suggestion.basemap} position={suggestion} />
		<!-- The action suffix targets the resolved memory page. -->
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<form method="POST" action={`${resolve('/memories/[id]', { id: suggestion.id })}?/coordinates`}>
			<input type="hidden" name="token" value={suggestion.token} />
			<Button type="submit">{m.memory.gpsAccept}</Button>
		</form>
		<a href={resolve('/memories/[id]', { id: suggestion.id })}>{m.memory.gpsSkip}</a>
	</section>
{:else}
	{#if form?.problem}
		<p role="alert">{form.problem === 'invalid' ? m.error.form : m.memory[form.problem]}</p>
	{/if}
	<form method="POST" enctype="multipart/form-data">
		<Field
			name="file"
			type="file"
			label={m.memory.file}
			hint={m.memory.formats(size)}
			accept="image/jpeg,image/png,image/heic,video/mp4,video/quicktime,.jpg,.jpeg,.png,.heic,.mp4,.mov"
			required
		/>
		<Field name="altText" label={m.memory.altText} hint={m.memory.altHint} maxlength={280} />
		<Textarea name="caption" label={m.memory.caption} maxlength={1000} rows={3} />
		<Button type="submit">{m.memory.uploadSubmit}</Button>
	</form>
{/if}
