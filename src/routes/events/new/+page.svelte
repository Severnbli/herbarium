<script lang="ts">
	import { resolve } from '$app/paths';
	import EventForm from '#lib/components/EventForm.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));
</script>

<svelte:head><title>{m.event.newTitle}</title></svelte:head>
<h1>{m.event.newTitle}</h1>
<EventForm
	{m}
	values={form?.values ?? data.values}
	fields={form?.fields}
	problem={form?.problem}
	submitLabel={m.event.create}
	cancelHref={data.calendarDate
		? `${resolve('/calendar')}?view=day&date=${data.calendarDate}`
		: resolve('/events')}
/>
