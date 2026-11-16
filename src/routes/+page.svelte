<script lang="ts">
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const m = $derived(messages(data.locale));
</script>

<!-- Placeholder home until the dashboard arrives in phase 9. -->
<h1>{m.appName}</h1>
<p>{m.home.greeting(data.displayName)}</p>
<p>{m.home.intro}</p>
