<script lang="ts">
	import { resolve } from '$app/paths';
	import Card from '#lib/components/Card.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const m = $derived(messages(data.locale));
</script>

<!-- Placeholder home until the dashboard arrives in phase 9. -->
<h1>{m.appName}</h1>
<Card title={m.event.listTitle} label={m.home.greeting(data.displayName)}>
	<p>{m.home.intro}</p>
	<a class="button" href={resolve('/events/new')}>{m.event.newTitle}</a>
</Card>
