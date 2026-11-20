<script lang="ts">
	import '#lib/design.css';
	import Ornament from '#lib/components/Ornament.svelte';
	import ThemePicker from '#lib/components/ThemePicker.svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import favicon from '#lib/assets/favicon.svg';
	import { messages } from '#lib/i18n/index.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	const m = $derived(messages(data.locale));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{m.appName}</title>
</svelte:head>

<a class="skip" href="#content">{m.design.skip}</a>
<header class="shell">
	<div class="masthead">
		<a class="brand" href={resolve('/')}>{m.appName}</a>
		{#if data.user}
			<a
				class="account-link"
				href={resolve('/account')}
				aria-current={page.url.pathname.startsWith('/account') ? 'page' : undefined}
			>
				{m.nav.account}
			</a>
		{:else}
			<ThemePicker {m} />
		{/if}
	</div>
	{#if data.user}
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
		</nav>
	{/if}
</header>

<main
	id="content"
	tabindex="-1"
	class:wide={['/', '/calendar', '/map'].includes(page.url.pathname)}
>
	{#if !data.user}
		<Ornament kind="flower" />
	{:else if page.url.pathname === '/'}
		<Ornament kind="divider" />
	{/if}
	{@render children()}
</main>

<style>
	.shell {
		border-bottom: 1px solid var(--line);
	}
	.masthead,
	nav {
		max-width: 76rem;
		margin-inline: auto;
		padding-inline: clamp(1rem, 4vw, 3rem);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
	}
	.masthead {
		padding-block: 0.65rem;
		justify-content: space-between;
		gap: 0.4rem 0.85rem;
	}
	.brand {
		font:
			1.55rem Herbarium Serif,
			serif;
		text-decoration: none;
		color: var(--ink);
	}
	nav {
		column-gap: 0.2rem;
		padding-bottom: 0.4rem;
	}
	nav a,
	.account-link {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding-inline: 0.65rem;
		border-radius: var(--radius);
		color: var(--ink);
		font-size: 0.92rem;
		text-decoration: none;
	}
	nav a:hover,
	.account-link:hover {
		background: var(--paper);
		text-decoration: underline;
	}
	a[aria-current='page'] {
		background: var(--paper);
		color: var(--madder);
		font-weight: 650;
		box-shadow: inset 0 -2px var(--madder);
	}
	.account-link {
		border: 1px solid var(--control-line);
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
