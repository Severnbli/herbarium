<script lang="ts">
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
	const problem = $derived(form?.problem ? problems[form.problem] : null);
</script>

<svelte:head>
	<title>{m.members.title}</title>
</svelte:head>

<h1>{m.members.title}</h1>

{#if problem}
	<p role="alert">{problem}</p>
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
		<p>{m.members.invitesIntro}</p>

		{#if form && 'inviteLink' in form}
			<div role="status">
				<p>{m.members.inviteCreated}</p>
				<Field
					name="inviteLink"
					label={m.members.inviteLink}
					value={form.inviteLink}
					readonly
					spellcheck="false"
				/>
			</div>
		{/if}

		<form method="POST" action="?/invite">
			<Field name="label" label={m.members.inviteLabel} maxlength={100} autocomplete="off" />
			<button>{m.members.createInvite}</button>
		</form>

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
		gap: 0.5rem;
	}
</style>
