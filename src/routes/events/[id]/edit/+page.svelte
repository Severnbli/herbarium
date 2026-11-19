<script lang="ts">
	import { resolve } from '$app/paths';
	import EventForm from '#lib/components/EventForm.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));
</script>

<svelte:head><title>{m.event.editTitle}</title></svelte:head>
<h1>{m.event.editTitle}</h1>
<EventForm
	{m}
	locale={data.locale}
	basemap={data.basemap}
	eventId={data.id}
	values={form?.values ?? data.values}
	fields={form?.fields}
	problem={form?.problem}
	submitLabel={m.event.save}
	cancelHref={resolve('/events/[id]', { id: data.id })}
/>
