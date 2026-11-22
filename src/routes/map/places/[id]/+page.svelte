<script lang="ts">
	import { resolve } from '$app/paths';
	import LocationPicker from '#lib/components/LocationPicker.svelte';
	import Field from '#lib/components/Field.svelte';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));
	const title = $derived(data.id === 'new' ? m.map.addSaved : data.values.place);
</script>

<svelte:head><title>{title}</title></svelte:head>
<a href={resolve('/map')}>{m.map.nav}</a>
<h1>{title}</h1>
<form method="POST" action="?/save">
	{#if form?.invalid}<p role="alert">{m.error.form}</p>{/if}
	{#key data.id}<LocationPicker
			{m}
			locale={data.locale}
			basemap={data.basemap}
			initial={form?.values ?? data.values}
			required
		/>{/key}
	<button>{m.map.savePlace}</button>
</form>
{#if data.id !== 'new'}
	<details open={!!form?.passwordError || !!form?.minutes}>
		<summary>{m.map.deletePlace}</summary>
		<form method="POST" action="?/remove">
			{#if form?.minutes}<p role="alert">{m.error.rateLimited(form.minutes)}</p>{/if}
			<Field
				name="currentPassword"
				type="password"
				label={m.account.confirmPassword}
				autocomplete="current-password"
				maxlength={256}
				error={form?.passwordError ? m.error.wrongPassword : undefined}
				required
			/>
			<button class="secondary">{m.map.deletePlace}</button>
		</form>
	</details>
{/if}

<style>
	details {
		margin-top: 2rem;
		border-top: 1px solid var(--line);
		padding-top: 1rem;
	}
	summary {
		cursor: pointer;
	}
</style>
