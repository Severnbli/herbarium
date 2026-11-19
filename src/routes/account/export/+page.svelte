<script lang="ts">
	import { resolve } from '$app/paths';
	import Field from '#lib/components/Field.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const m = $derived(messages(data.locale));
</script>

<svelte:head><title>{m.archive.title}</title></svelte:head>

<a href={resolve('/account')}>{m.account.title}</a>
<h1>{m.archive.title}</h1>
<p>{m.archive.description}</p>
{#if data.problem}
	<p role="alert">
		{data.problem === 'password' ? m.error.wrongPassword : m.archive[data.problem]}
	</p>
{/if}
<form method="POST" action="/account/export/download">
	<Field
		name="currentPassword"
		type="password"
		label={m.account.confirmPassword}
		autocomplete="current-password"
		required
		maxlength={256}
	/>
	<button>{m.archive.download}</button>
</form>

<style>
	form {
		max-width: 28rem;
	}
</style>
