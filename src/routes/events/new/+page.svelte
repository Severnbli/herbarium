<script lang="ts">
	import { resolve } from '$app/paths';
	import EventForm from '#lib/components/EventForm.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const heading = $derived(data.values.dateMode === 'undated' ? m.event.newPlan : m.event.newTitle);
</script>

<svelte:head><title>{heading}</title></svelte:head>
<h1>{heading}</h1>
{#key data.values}
	<EventForm
		{m}
		locale={data.locale}
		savedPlaces={data.savedPlaces}
		places={form?.places ?? []}
		basemap={data.basemap}
		values={form?.values ?? data.values}
		fields={form?.fields}
		problem={form?.problem}
		submitLabel={m.event.create}
		cancelHref={data.calendarDate
			? `${resolve('/calendar')}?view=day&date=${data.calendarDate}`
			: resolve('/events')}
	/>
{/key}
