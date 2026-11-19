<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const m = $derived(messages(data.locale));
</script>

<svelte:head><title>{m.mediaImport.title}</title></svelte:head>
<a href={resolve('/memories')}>{m.memory.back}</a>
<h1>{m.mediaImport.title}</h1>
<p>{m.mediaImport.intro}</p>
<form method="POST">
	<Button type="submit">{m.mediaImport.start}</Button>
</form>
