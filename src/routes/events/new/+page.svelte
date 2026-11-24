<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import EventForm from '#lib/components/EventForm.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const heading = $derived(
		data.values.kind === 'plan'
			? m.event.newPlan
			: data.values.kind === 'occasion'
				? m.event.newOccasion
				: m.event.newTitle
	);
</script>

<svelte:head><title>{heading}</title></svelte:head>
{#if !data.calendarDate}
	<a href={resolve(data.planContext ? '/plans' : '/events')}>
		{data.planContext ? m.event.backToPlans : m.event.back}
	</a>
{/if}
<h1>{heading}</h1>
{#key page.url.search}
	<EventForm
		{m}
		locale={data.locale}
		savedPlaces={data.savedPlaces}
		places={form?.places ?? []}
		basemap={data.basemap}
		values={form?.values ?? data.values}
		fields={form?.fields}
		problem={form?.problem}
		fixedKind={data.fixedKind}
		submitLabel={data.fixedKind === 'plan' ? m.plans.create : m.event.create}
		cancelHref={data.calendarDate
			? `${resolve('/calendar')}?view=day&date=${data.calendarDate}`
			: resolve(data.planContext ? '/plans' : '/events')}
	/>
{/key}
