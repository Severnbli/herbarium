<script lang="ts">
	import { resolve } from '$app/paths';
	import Field from '#lib/components/Field.svelte';
	import NewPasswordFields from '#lib/components/NewPasswordFields.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const invalid = $derived(
		new Set(form?.problem === 'invalid' || form?.problem === 'username_taken' ? form.fields : [])
	);
	const values = $derived(form && 'values' in form ? form.values : undefined);
	const usable = $derived(data.valid && form?.problem !== 'invalid_invite');
</script>

<svelte:head>
	<title>{usable ? m.invite.title : m.invite.invalidTitle}</title>
</svelte:head>

{#if usable}
	<h1>{m.invite.title}</h1>
	<p>{m.invite.intro}</p>

	{#if form?.problem === 'invalid'}
		<p role="alert">{m.error.form}</p>
	{/if}

	<form method="POST">
		<Field
			name="username"
			label={m.field.username}
			hint={m.hint.username}
			error={form?.problem === 'username_taken'
				? m.error.usernameTaken
				: invalid.has('username')
					? m.error.username
					: null}
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
		<button>{m.invite.submit}</button>
	</form>
{:else}
	<h1>{m.invite.invalidTitle}</h1>
	<p>{m.invite.invalid}</p>
	<p><a href={resolve('/login')}>{m.invite.toLogin}</a></p>
{/if}
