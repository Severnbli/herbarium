<script lang="ts">
	import Field from '#lib/components/Field.svelte';
	import NewPasswordFields from '#lib/components/NewPasswordFields.svelte';
	import { formatRelative } from '#lib/i18n/format.ts';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));

	/** Errors and results belong to the section whose form was sent. */
	const at = (section: string) => (form?.section === section ? form : null);
	const invalidIn = (section: string) => {
		const f = at(section);
		return new Set(f && 'fields' in f ? f.fields : []);
	};
	const setup = $derived(form && 'setup' in form ? form.setup : null);
	const recoveryCodes = $derived(form && 'recoveryCodes' in form ? form.recoveryCodes : null);
</script>

<svelte:head>
	<title>{m.account.title}</title>
</svelte:head>

{#snippet problem(section: string)}
	{@const f = at(section)}
	{#if f && 'problem' in f && f.problem === 'rate_limited' && 'minutes' in f}
		<p role="alert">{m.error.rateLimited(f.minutes)}</p>
	{:else if f && 'problem' in f && f.problem === 'invalid'}
		<p role="alert">{m.error.form}</p>
	{/if}
{/snippet}

{#snippet confirmWithPassword(section: string)}
	<Field
		name="currentPassword"
		id="{section}-current-password"
		type="password"
		label={m.account.confirmPassword}
		error={invalidIn(section).has('currentPassword') ? m.error.wrongPassword : null}
		autocomplete="current-password"
		required
		maxlength={256}
	/>
{/snippet}

<h1>{m.account.title}</h1>

<section aria-labelledby="password-title">
	<h2 id="password-title">{m.account.passwordTitle}</h2>
	{@render problem('password')}
	{#if form && 'done' in form && form.done === 'password_changed'}
		<p role="status">{m.account.passwordChanged}</p>
	{/if}
	<form method="POST" action="?/changePassword">
		<Field
			name="currentPassword"
			type="password"
			label={m.field.currentPassword}
			error={invalidIn('password').has('currentPassword') ? m.error.wrongPassword : null}
			autocomplete="current-password"
			required
			maxlength={256}
		/>
		<NewPasswordFields {m} invalid={invalidIn('password')} label={m.field.newPassword} />
		<button>{m.account.changePassword}</button>
	</form>
</section>

<section aria-labelledby="totp-title">
	<h2 id="totp-title">{m.account.totpTitle}</h2>
	{@render problem('totp')}
	{#if form && 'done' in form && form.done === 'totp_enabled'}
		<p role="status">{m.account.totpEnabled}</p>
	{:else if form && 'done' in form && form.done === 'totp_disabled'}
		<p role="status">{m.account.totpDisabled}</p>
	{/if}

	{#if setup}
		<p>{m.account.totpScan}</p>
		<svg
			class="qr"
			viewBox="0 0 {setup.qr.size} {setup.qr.size}"
			role="img"
			aria-label={m.account.totpQrLabel}
			shape-rendering="crispEdges"
		>
			<rect width={setup.qr.size} height={setup.qr.size} fill="#fff" />
			<path d={setup.qr.path} fill="#000" />
		</svg>
		<p>{m.account.totpKey}: <code>{setup.secret}</code></p>
		<form method="POST" action="?/totpConfirm">
			<Field
				name="code"
				label={m.verify.code}
				error={invalidIn('totp').has('code') ? m.verify.invalid : null}
				autocomplete="one-time-code"
				inputmode="numeric"
				pattern={'[0-9]{6}'}
				maxlength={6}
				required
			/>
			<button>{m.account.totpConfirm}</button>
		</form>
	{:else if data.totpEnabled}
		<p>{m.account.totpOn}</p>
		<form method="POST" action="?/totpDisable">
			{@render confirmWithPassword('totp')}
			<button>{m.account.totpDisable}</button>
		</form>
	{:else}
		<p>{m.account.totpOff}</p>
		<form method="POST" action="?/totpBegin">
			{@render confirmWithPassword('totp')}
			<button>{m.account.totpStart}</button>
		</form>
	{/if}
</section>

{#if data.totpEnabled || recoveryCodes}
	<section aria-labelledby="recovery-title">
		<h2 id="recovery-title">{m.account.recoveryTitle}</h2>
		{@render problem('recovery')}
		{#if recoveryCodes}
			<p role="status">{m.account.recoveryShown}</p>
			<ul class="codes">
				{#each recoveryCodes as code (code)}
					<li><code>{code}</code></li>
				{/each}
			</ul>
		{:else}
			<p>{m.account.recoveryLeft(data.recoveryCodesLeft)}</p>
		{/if}
		{#if data.totpEnabled}
			<form method="POST" action="?/recoveryCodes">
				{@render confirmWithPassword('recovery')}
				<button>{m.account.recoveryRegenerate}</button>
			</form>
		{/if}
	</section>
{/if}

<section aria-labelledby="sessions-title">
	<h2 id="sessions-title">{m.account.sessionsTitle}</h2>
	<ul>
		{#each data.sessions as session (session.id)}
			<li>
				<span>
					<strong>{session.device ?? m.account.unknownDevice}</strong>
					{#if session.current}({m.account.thisDevice}){/if}
					– {m.account.lastActive(formatRelative(data.locale, session.lastSeenAt, data.now))}
				</span>
				<form method="POST" action="?/revokeSession">
					<input type="hidden" name="id" value={session.id} />
					<button>{m.account.signOutDevice}</button>
				</form>
			</li>
		{/each}
	</ul>
	<form method="POST" action="?/signOutEverywhere">
		<p>{m.account.signOutEverywhereHint}</p>
		<button>{m.account.signOutEverywhere}</button>
	</form>
</section>

<style>
	ul {
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
		justify-content: space-between;
		padding-block: 0.5rem;
	}

	.qr {
		width: 14rem;
		height: 14rem;
	}

	.codes {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
	}
</style>
