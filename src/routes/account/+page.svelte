<script lang="ts">
	import AccountSettings from '#lib/components/AccountSettings.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>{messages(data.locale).account.title}</title></svelte:head>
<AccountSettings {data} {form} />
