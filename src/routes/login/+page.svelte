<script lang="ts">
	import Field from '#lib/components/Field.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));
</script>

<svelte:head>
	<title>{m.login.title}</title>
</svelte:head>

<h1>{m.login.title}</h1>

{#if form?.problem === 'rate_limited'}
	<p role="alert">{m.error.rateLimited(form.minutes)}</p>
{:else if form?.problem === 'invalid'}
	<p role="alert">{m.login.invalid}</p>
{/if}

<form method="POST">
	<input type="hidden" name="next" value={data.next} />
	<Field
		name="username"
		label={m.field.username}
		value={form?.username ?? ''}
		autocomplete="username"
		autocapitalize="none"
		spellcheck="false"
		required
		maxlength={64}
	/>
	<Field
		name="password"
		type="password"
		label={m.field.password}
		autocomplete="current-password"
		required
		maxlength={256}
	/>
	<button>{m.login.submit}</button>
</form>
