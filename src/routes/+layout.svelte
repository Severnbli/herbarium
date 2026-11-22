<script lang="ts">
	import '#lib/design.css';
	import { preloadData, goto, invalidate, invalidateAll, afterNavigate } from '$app/navigation';
	import { applyAction } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import type { PageProps as AccountProps } from './account/$types';
	import AccountSettings from '#lib/components/AccountSettings.svelte';
	import Dialog from '#lib/components/Dialog.svelte';
	import Ornament from '#lib/components/Ornament.svelte';
	import ThemePicker from '#lib/components/ThemePicker.svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import favicon from '#lib/assets/favicon.svg';
	import { messages } from '#lib/i18n/index.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	let accountOpen = $state(false);
	let account = $state.raw<AccountProps['data']>();
	let accountForm = $state.raw<AccountProps['form']>(null);
	afterNavigate(() => {
		accountOpen = false;
		account = undefined;
		accountForm = null;
	});
	async function loadAccount() {
		const url = resolve('/account');
		const result = await preloadData(url);
		if (result.type === 'loaded' && result.status === 200) {
			account = result.data as AccountProps['data'];
			return true;
		}
		await goto(url);
		return false;
	}
	async function openAccount(e: MouseEvent) {
		if (
			e.button ||
			e.metaKey ||
			e.ctrlKey ||
			e.shiftKey ||
			e.altKey ||
			page.url.pathname === '/account'
		)
			return;
		e.preventDefault();
		accountForm = null;
		accountOpen = await loadAccount();
	}
	const submitAccount: SubmitFunction =
		() =>
		async ({ result }) => {
			if (
				(result.type === 'redirect' && !result.location.startsWith('/account')) ||
				result.type === 'error'
			) {
				await applyAction(result);
				return;
			}
			if (result.type === 'success' || result.type === 'failure')
				accountForm = result.data as AccountProps['form'];
			if (result.type !== 'failure') {
				if (result.type === 'redirect') await invalidateAll();
				else await invalidate('herbarium:account');
				if (accountOpen) await loadAccount();
			}
		};
	$effect(() => {
		document.documentElement.lang = data.locale;
	});
	const m = $derived(messages(data.locale));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{m.appName}</title>
</svelte:head>

<a class="skip" href="#content">{m.design.skip}</a>
<header class="shell">
	<div class="masthead">
		<a class="brand" href={resolve('/')}
			><span class="brand-flower"><Ornament /></span>{m.appName}</a
		>
		{#if data.user}
			<a
				class="account-link"
				onclick={openAccount}
				aria-haspopup="dialog"
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
			<a
				href={resolve('/map')}
				aria-current={page.url.pathname.startsWith('/map') ? 'page' : undefined}>{m.map.nav}</a
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

{#if data.user}
	<Dialog bind:open={accountOpen} title={m.account.title} closeLabel={m.design.close}>
		{#if accountOpen && account}<AccountSettings
				data={account}
				form={accountForm}
				submit={submitAccount}
			/>{/if}
	</Dialog>
{/if}

<main
	id="content"
	tabindex="-1"
	class:wide={['/', '/calendar', '/map', '/memories'].includes(page.url.pathname)}
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
		background: var(--paper);
		border-top: 3px solid var(--moss);
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
	.brand-flower :global(svg) {
		width: 1.8rem;
		height: 2.3rem;
		margin: 0;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
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
		background: var(--linen);
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
