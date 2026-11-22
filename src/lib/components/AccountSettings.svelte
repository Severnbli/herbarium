<script lang="ts">
	import { resolve } from '$app/paths';
	import Field from '#lib/components/Field.svelte';
	import ThemePicker from '#lib/components/ThemePicker.svelte';
	import NewPasswordFields from '#lib/components/NewPasswordFields.svelte';
	import { formatRelative } from '#lib/i18n/format.ts';
	import { LOCALES, messages } from '#lib/i18n/index.ts';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import type { PageProps } from '../../routes/account/$types';

	let { data, form, submit }: Pick<PageProps, 'data' | 'form'> & { submit?: SubmitFunction } =
		$props();
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

<div class="account-heading">
	<div>
		{#if !submit}<h1>{m.account.title}</h1>{/if}
		<p>{data.user?.displayName}</p>
	</div>
	<form method="POST" action={resolve('/logout')}>
		<button class="secondary">{m.nav.signOut}</button>
	</form>
</div>

<section class="preferences" aria-labelledby="account-preferences">
	<h2 id="account-preferences">{m.account.preferences}</h2>
	{@render problem('language')}
	<form method="POST" use:enhance={submit} action={resolve('/account') + '?/language'}>
		<label for="language">{m.language.label}</label>
		<select id="language" name="locale" value={data.locale}>
			{#each LOCALES as locale (locale)}
				<option value={locale} lang={locale}>{m.language[locale]}</option>
			{/each}
		</select>
		<button class="secondary">{m.language.save}</button>
	</form>
	<ThemePicker {m} />
</section>

<section aria-labelledby="reminder-preferences">
	<details open={!submit || !!at('reminders')}>
		<summary id="reminder-preferences">{m.reminder.preferences}</summary>
		{@render problem('reminders')}
		{#if !data.reminderMailAvailable}<p>{m.reminder.unavailable}</p>{/if}
		<form method="POST" use:enhance={submit} action={resolve('/account') + '?/reminders'}>
			<Field
				name="timeZone"
				label={m.event.timeZone}
				hint={m.reminder.zoneHint}
				value={data.reminderPreferences.timeZone}
				error={invalidIn('reminders').has('timeZone') ? m.event.invalidField : null}
				required
				maxlength={100}
			/>
			<Field
				name="email"
				type="email"
				label={m.reminder.email}
				value={data.reminderPreferences.email}
				error={invalidIn('reminders').has('email') ? m.event.invalidField : null}
				autocomplete="email"
				maxlength={254}
			/>
			<label class="reminder-option">
				<input type="checkbox" name="enabled" checked={data.reminderPreferences.enabled} />
				{m.reminder.enable}
			</label>
			<p>{m.reminder.privacy}</p>
			<button>{m.reminder.savePreferences}</button>
		</form>
	</details>
</section>

<section aria-labelledby="password-title">
	<details open={!submit || !!at('password')}>
		<summary id="password-title">{m.account.passwordTitle}</summary>
		{@render problem('password')}
		{#if form && 'done' in form && form.done === 'password_changed'}
			<p role="status">{m.account.passwordChanged}</p>
		{/if}
		<form method="POST" use:enhance={submit} action={resolve('/account') + '?/changePassword'}>
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
	</details>
</section>

<section aria-labelledby="totp-title">
	<details open={!submit || !!at('totp') || !!setup}>
		<summary id="totp-title">{m.account.totpTitle}</summary>
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
			<form method="POST" use:enhance={submit} action={resolve('/account') + '?/totpConfirm'}>
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
			<form method="POST" use:enhance={submit} action={resolve('/account') + '?/totpDisable'}>
				{@render confirmWithPassword('totp')}
				<button>{m.account.totpDisable}</button>
			</form>
		{:else}
			<p>{m.account.totpOff}</p>
			<form method="POST" use:enhance={submit} action={resolve('/account') + '?/totpBegin'}>
				{@render confirmWithPassword('totp')}
				<button>{m.account.totpStart}</button>
			</form>
		{/if}
	</details>
</section>

{#if data.totpEnabled || recoveryCodes}
	<section aria-labelledby="recovery-title">
		<details open={!submit || !!at('recovery') || !!recoveryCodes}>
			<summary id="recovery-title">{m.account.recoveryTitle}</summary>
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
				<form method="POST" use:enhance={submit} action={resolve('/account') + '?/recoveryCodes'}>
					{@render confirmWithPassword('recovery')}
					<button>{m.account.recoveryRegenerate}</button>
				</form>
			{/if}
		</details>
	</section>
{/if}

<section aria-labelledby="sessions-title">
	<details open={!submit || !!at('sessions')}>
		<summary id="sessions-title">{m.account.sessionsTitle}</summary>
		<ul>
			{#each data.sessions as session (session.id)}
				<li>
					<span>
						<strong>{session.device ?? m.account.unknownDevice}</strong>
						{#if session.current}({m.account.thisDevice}){/if}
						– {m.account.lastActive(formatRelative(data.locale, session.lastSeenAt, data.now))}
					</span>
					{#if !session.current}
						<form
							method="POST"
							use:enhance={submit}
							action={resolve('/account') + '?/revokeSession'}
						>
							<input type="hidden" name="id" value={session.id} />
							<button class="secondary">{m.account.signOutDevice}</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
		<form method="POST" use:enhance={submit} action={resolve('/account') + '?/signOutEverywhere'}>
			<p>{m.account.signOutEverywhereHint}</p>
			<button>{m.account.signOutEverywhere}</button>
		</form>
	</details>
</section>

<p class="export"><a href={resolve('/account/export')}>{m.archive.title}</a></p>

<style>
	section summary {
		font-family:
			Herbarium Serif,
			serif;
		font-size: 1.25rem;
		cursor: pointer;
		padding-block: 0.4rem;
		color: var(--ink);
	}
	section {
		margin-block: 1rem;
	}
	.account-heading,
	.preferences form {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.65rem;
	}
	.account-heading {
		justify-content: space-between;
	}
	.account-heading h1,
	.account-heading p {
		margin: 0;
		overflow-wrap: anywhere;
	}
	.account-heading p {
		color: var(--muted);
	}
	.preferences {
		padding: 0.85rem clamp(0.85rem, 4vw, 1.35rem);
		background: var(--linen);
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.preferences h2 {
		margin-top: 0;
	}
	.preferences form {
		margin-block-end: 0.85rem;
	}
	.export {
		margin-top: 2rem;
	}

	.reminder-option {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}
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
