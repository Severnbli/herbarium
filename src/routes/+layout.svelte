<script lang="ts">
	import '#lib/design.css';
	import Ornament from '#lib/components/Ornament.svelte';
	import ThemePicker from '#lib/components/ThemePicker.svelte';
	import { page } from '$app/state';
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

<a class="skip" href="#content">{m.design.skip}</a>
<div class="masthead">
	<a class="brand" href={resolve('/')}>{m.appName}</a>
	<ThemePicker {m} />
</div>
{#if data.user}
	<header>
		<nav aria-label={m.nav.label}>
			<a href={resolve('/')} aria-current={page.url.pathname === '/' ? 'page' : undefined}
				>{m.nav.home}</a
			>
			<a
				href={resolve('/calendar')}
				aria-current={page.url.pathname === '/calendar' ? 'page' : undefined}>{m.calendar.title}</a
			>
			<a
				href={resolve('/events')}
				aria-current={page.url.pathname.startsWith('/events') ? 'page' : undefined}
				>{m.nav.events}</a
			>
			<a
				href={resolve('/timeline')}
				aria-current={page.url.pathname === '/timeline' ? 'page' : undefined}>{m.timeline.title}</a
			>
			<a href={resolve('/map')} aria-current={page.url.pathname === '/map' ? 'page' : undefined}
				>{m.map.nav}</a
			>
			<a
				href={resolve('/memories')}
				aria-current={page.url.pathname.startsWith('/memories') ? 'page' : undefined}
				>{m.nav.memories}</a
			>
			<a
				href={resolve('/members')}
				aria-current={page.url.pathname === '/members' ? 'page' : undefined}>{m.nav.members}</a
			>
			<a
				href={resolve('/account')}
				aria-current={page.url.pathname === '/account' ? 'page' : undefined}>{m.nav.account}</a
			>
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

<main
	id="content"
	tabindex="-1"
	class:wide={['/', '/calendar', '/map'].includes(page.url.pathname)}
>
	<Ornament kind={data.user ? 'divider' : 'flower'} />
	{@render children()}
</main>

<style>
	.masthead,
	header {
		max-width: 76rem;
		margin: auto;
		padding: 1rem clamp(1rem, 4vw, 3rem);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}
	.masthead {
		border-bottom: 1px solid var(--line);
	}
	.brand {
		font:
			1.6rem Herbarium Serif,
			serif;
		text-decoration: none;
		color: var(--ink);
	}
	nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	nav a[aria-current='page'] {
		font-weight: bold;
		text-decoration-thickness: 2px;
	}
	header form {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}
	header form > button {
		margin: 0;
	}
	main {
		max-width: 48rem;
		margin: clamp(1rem, 4vw, 3rem) auto;
		padding: clamp(1.25rem, 5vw, 3.5rem);
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}
	main.wide {
		max-width: 76rem;
	}
	.skip {
		position: absolute;
		top: -6rem;
		left: 1rem;
		padding: 0.75rem;
		background: var(--paper);
		z-index: 10;
	}
	.skip:focus {
		top: 1rem;
	}
	@media (max-width: 78rem) {
		main.wide {
			margin-inline: 1rem;
		}
	}
	@media (max-width: 50rem) {
		main {
			margin-inline: 1rem;
		}
	}
</style>
