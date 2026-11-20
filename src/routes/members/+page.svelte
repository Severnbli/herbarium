<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '#lib/components/Button.svelte';
	import Field from '#lib/components/Field.svelte';
	import { formatRelative } from '#lib/i18n/format.ts';
	import { messages } from '#lib/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const m = $derived(messages(data.locale));

	const problems = $derived({
		last_owner: m.members.lastOwner,
		cannot_deactivate_self: m.members.cannotDeactivateSelf,
		not_found: m.members.notFound,
		username_taken: m.members.notFound,
		already_set_up: m.members.notFound,
		invalid: m.error.form
	});
	let canCopy = $state(false);
	let copyStatus = $state('');
	onMount(() => {
		canCopy = !!navigator.clipboard;
	});
	async function copyLink(link: string) {
		try {
			await navigator.clipboard.writeText(link);
			copyStatus = m.members.copied;
		} catch {
			copyStatus = m.members.copyFailed;
		}
	}
	const problem = $derived(form?.problem ? problems[form.problem] : null);
</script>

<svelte:head>
	<title>{m.members.title}</title>
</svelte:head>

<h1>{m.members.title}</h1>

{#if problem && form?.problem !== 'invalid'}
	<p role="alert">{problem}</p>
{/if}

{#if data.isOwner}
	<section class="invite-card" aria-labelledby="invite-new">
		<h2 id="invite-new">{m.members.inviteNew}</h2>
		<p>{m.members.invitesIntro}</p>
		<form method="POST" action="?/invite#invite-new">
			<Field name="label" label={m.members.inviteLabel} maxlength={100} autocomplete="off" />
			{#if form?.problem === 'invalid'}<p role="alert">{problem}</p>{/if}
			<Button type="submit">{m.members.createInvite}</Button>
		</form>
		{#if form?.inviteLink && form.expiresAt !== undefined}
			{@const link = form.inviteLink}
			<div class="invite-result">
				<p role="status">
					{m.members.inviteCreated}
					{m.members.inviteExpires(formatRelative(data.locale, form.expiresAt, data.now))}
				</p>
				<Field
					name="inviteLink"
					label={m.members.inviteLink}
					value={link}
					readonly
					spellcheck="false"
				/>
				{#if canCopy}
					<Button type="button" variant="secondary" onclick={() => copyLink(link)}>
						{m.members.copyLink}
					</Button>
					<span class="copy-feedback" role="status">{copyStatus}</span>
				{/if}
			</div>
		{/if}
	</section>
{/if}

<ul class="members">
	{#each data.members as member (member.id)}
		{@const self = member.id === data.currentUserId}
		<li>
			<span>
				<strong>{member.displayName}</strong>
				({member.username}{self ? `, ${m.members.you}` : ''}) –
				{m.members.role[member.role]}{member.deactivated ? `, ${m.members.deactivated}` : ''}
			</span>
			{#if data.isOwner}
				<span class="actions" role="group" aria-label={m.members.actionsFor(member.displayName)}>
					{#if !member.deactivated}
						<form method="POST" action="?/setRole">
							<input type="hidden" name="id" value={member.id} />
							<input
								type="hidden"
								name="role"
								value={member.role === 'owner' ? 'member' : 'owner'}
							/>
							<button>
								{member.role === 'owner' ? m.members.makeMember : m.members.makeOwner}
							</button>
						</form>
					{/if}
					{#if !self}
						<form method="POST" action={member.deactivated ? '?/reactivate' : '?/deactivate'}>
							<input type="hidden" name="id" value={member.id} />
							<button>{member.deactivated ? m.members.reactivate : m.members.deactivate}</button>
						</form>
					{/if}
				</span>
			{/if}
		</li>
	{/each}
</ul>

{#if data.isOwner}
	<section aria-labelledby="invites-title">
		<h2 id="invites-title">{m.members.invitesTitle}</h2>

		{#if data.invites.length === 0}
			<p>{m.members.noInvites}</p>
		{:else}
			<ul class="invites">
				{#each data.invites as invite (invite.id)}
					<li>
						<span>
							{#if invite.label}<strong>{invite.label}</strong> –{/if}
							{m.members.inviteStatus[invite.status]}.
							{m.members.inviteMeta(
								invite.createdByName,
								formatRelative(data.locale, invite.createdAt, data.now)
							)}.
							{#if invite.status === 'pending'}
								{m.members.inviteExpires(formatRelative(data.locale, invite.expiresAt, data.now))}.
							{/if}
						</span>
						{#if invite.status === 'pending'}
							<form method="POST" action="?/revokeInvite">
								<input type="hidden" name="id" value={invite.id} />
								<button>{m.members.revoke}</button>
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style>
	.invite-card {
		padding: clamp(1rem, 4vw, 1.75rem);
		background: var(--linen);
		border: 1px solid var(--line);
		border-top: 3px solid var(--madder);
		border-radius: var(--radius);
		margin-block: 1.5rem;
	}
	.invite-card h2 {
		margin-top: 0;
	}
	.invite-result {
		margin-top: 1rem;
		padding-top: 0.25rem;
		border-top: 1px solid var(--line);
	}
	.copy-feedback:not(:empty) {
		margin-inline-start: 0.5rem;
	}
	.invite-result :global(input) {
		width: 100%;
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

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
