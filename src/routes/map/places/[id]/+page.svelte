<script lang="ts">
	import { resolve } from '$app/paths';
	import LocationPicker from '#lib/components/LocationPicker.svelte';
	import DeleteConfirmation from '#lib/components/DeleteConfirmation.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const title = $derived(data.id === 'new' ? m.map.addSaved : data.values.place);
</script>

<svelte:head><title>{title}</title></svelte:head>
<a href={resolve('/map')}>{m.map.nav}</a>
<h1>{title}</h1>
<form method="POST" action="?/save">
	{#if form?.invalid}<p role="alert">{m.error.form}</p>{/if}
	{#key data.id}<LocationPicker
			{m}
			locale={data.locale}
			basemap={data.basemap}
			initial={form?.values ?? data.values}
			required
		/>{/key}
	<button>{m.map.savePlace}</button>
</form>
{#if data.id !== 'new'}
	<DeleteConfirmation
		action="?/remove"
		label={m.map.deletePlace}
		description={m.map.deletePlaceHint}
		error={form?.deleteProblem ? m.error.form : undefined}
	/>
{/if}
