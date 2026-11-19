<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { DEFAULT_LOCALE, isLocale, messages } from '#lib/i18n/index.ts';

	const m = $derived(messages(isLocale(page.data.locale) ? page.data.locale : DEFAULT_LOCALE));
	const title = $derived(
		page.status === 404
			? m.errorPage.notFound
			: page.status === 403
				? m.errorPage.forbidden
				: m.errorPage.generic
	);
</script>

<svelte:head>
	<title>{title}</title>
</svelte:head>

<h1>{title}</h1>
{#if page.status >= 500 && page.error?.id}
	<p>{m.errorPage.reference(page.error.id)}</p>
{/if}
<p><a href={resolve('/')}>{m.errorPage.home}</a></p>
