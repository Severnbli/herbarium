<script lang="ts">
	import { resolve } from '$app/paths';
	import EventForm from '#lib/components/EventForm.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const heading = $derived(data.planContext ? m.plans.edit : m.event.editTitle);
</script>

<svelte:head><title>{heading}</title></svelte:head>
<h1>{heading}</h1>
{#key data.id}
	<EventForm
		{m}
		locale={data.locale}
		savedPlaces={data.savedPlaces}
		places={form?.places ?? data.places}
		basemap={data.basemap}
		eventId={data.id}
		values={form?.values ?? data.values}
		fields={form?.fields}
		problem={form?.problem}
		submitLabel={m.event.save}
		cancelHref={resolve('/events/[id]', { id: data.id })}
	/>
{/key}
