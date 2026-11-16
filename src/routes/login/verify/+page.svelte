<script lang="ts">
	import Field from '#lib/components/Field.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));
</script>

<svelte:head>
	<title>{m.verify.title}</title>
</svelte:head>

<h1>{m.verify.title}</h1>

{#if form?.problem === 'rate_limited'}
	<p role="alert">{m.error.rateLimited(form.minutes)}</p>
{/if}

<form method="POST" action="?/code">
	<input type="hidden" name="next" value={data.next} />
	<p>{m.verify.intro}</p>
	<Field
		name="code"
		label={m.verify.code}
		error={form?.problem === 'invalid' && form.kind === 'code' ? m.verify.invalid : null}
		autocomplete="one-time-code"
		inputmode="numeric"
		pattern={'[0-9]{6}'}
		maxlength={6}
		required
	/>
	<button>{m.verify.submit}</button>
</form>

<section aria-labelledby="recovery-title">
	<h2 id="recovery-title">{m.verify.recoveryTitle}</h2>
	<form method="POST" action="?/recovery">
		<input type="hidden" name="next" value={data.next} />
		<p>{m.verify.recoveryIntro}</p>
		<Field
			name="recoveryCode"
			label={m.verify.recoveryCode}
			error={form?.problem === 'invalid' && form.kind === 'recovery'
				? m.verify.recoveryInvalid
				: null}
			autocomplete="off"
			autocapitalize="characters"
			spellcheck="false"
			maxlength={32}
			required
		/>
		<button>{m.verify.recoverySubmit}</button>
	</form>
</section>

<form method="POST" action="?/restart">
	<button>{m.verify.restart}</button>
</form>
