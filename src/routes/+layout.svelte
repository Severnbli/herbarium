<script lang="ts">
	import { resolve } from '$app/paths';
	import favicon from '#lib/assets/favicon.svg';
	import { LOCALES, messages } from '#lib/i18n/index.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	const m = $derived(messages(data.locale));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{m.appName}</title>
</svelte:head>

{#if data.user}
	<header>
		<nav aria-label={m.nav.label}>
			<a href={resolve('/')}>{m.nav.home}</a>
			<a href={resolve('/members')}>{m.nav.members}</a>
			<a href={resolve('/account')}>{m.nav.account}</a>
		</nav>
		<form method="POST" action="/account?/language">
			<label for="language">{m.language.label}</label>
			<select id="language" name="locale" value={data.locale}>
				{#each LOCALES as locale (locale)}
					<option value={locale} lang={locale}>{m.language[locale]}</option>
				{/each}
			</select>
			<button>{m.language.save}</button>
		</form>
		<form method="POST" action="/logout">
			<button>{m.nav.signOut}</button>
		</form>
	</header>
{/if}

<main>
	{@render children()}
</main>

<style>
	/* Bare structure only; the herbarium design system arrives in phase 2. */
	header {
		display: flex;
		flex-wrap: wrap;
		gap: 1rem;
		align-items: center;
		justify-content: space-between;
		padding: 1rem;
	}

	nav {
		display: flex;
		gap: 1rem;
	}

	main {
		max-width: 40rem;
		margin: 0 auto;
		padding: 1rem;
	}
</style>
