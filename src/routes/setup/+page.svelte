<script lang="ts">
	import Field from '#lib/components/Field.svelte';
	import NewPasswordFields from '#lib/components/NewPasswordFields.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const invalid = $derived(new Set(form?.problem === 'invalid' ? form.fields : []));
	const values = $derived(form?.problem === 'invalid' ? form.values : undefined);
</script>

<svelte:head>
	<title>{m.setup.title}</title>
</svelte:head>

<h1>{m.setup.title}</h1>
<p>{m.setup.intro}</p>

{#if form?.problem === 'rate_limited'}
	<p role="alert">{m.error.rateLimited(form.minutes ?? 1)}</p>
{:else if form?.problem === 'invalid'}
	<p role="alert">{m.error.form}</p>
{/if}

<form method="POST">
	<Field
		name="code"
		label={m.setup.code}
		hint="{m.setup.codeHint} {m.setup.codeCommand}"
		error={invalid.has('code') ? m.setup.wrongCode : null}
		autocomplete="off"
		spellcheck="false"
		required
	/>
	<Field
		name="username"
		label={m.field.username}
		hint={m.hint.username}
		error={invalid.has('username') ? m.error.username : null}
		value={values?.username ?? ''}
		autocomplete="username"
		autocapitalize="none"
		spellcheck="false"
		required
		minlength={3}
		maxlength={32}
	/>
	<Field
		name="displayName"
		label={m.field.displayName}
		hint={m.hint.displayName}
		error={invalid.has('displayName') ? m.error.displayName : null}
		value={values?.displayName ?? ''}
		autocomplete="name"
		required
		maxlength={64}
	/>
	<NewPasswordFields {m} {invalid} />

	<section aria-labelledby="key-title">
		<h2 id="key-title">{m.setup.keyTitle}</h2>
		<p>{m.setup.keyWarning}</p>
		<label>
			<input type="checkbox" name="acknowledge" required />
			{m.setup.keyAck}
		</label>
		{#if invalid.has('acknowledge')}
			<p role="alert">{m.setup.keyAckRequired}</p>
		{/if}
	</section>

	<button>{m.setup.submit}</button>
</form>
