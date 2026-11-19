import { fail, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { audit } from '#lib/server/audit.ts';
import { db } from '#lib/server/app.ts';
import { requireOwner, requireUser } from '#lib/server/auth/guard.ts';
import { createInvite, listInvites, revokeInvite } from '#lib/server/auth/invites.ts';
import {
	deactivateMember,
	listMembers,
	MemberError,
	reactivateMember,
	setRole
} from '#lib/server/auth/members.ts';
import { parseForm } from '#lib/server/auth/schemas.ts';
import { deleteSession } from '#lib/server/auth/session.ts';
import { getConfig } from '#lib/server/config.ts';
import { ROLES } from '#lib/server/db/schema.ts';
import { clientIp, startSession } from '#lib/server/http/request.ts';
import type { Actions, PageServerLoad } from './$types';

const id = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const target = z.strictObject({ id });

export const load: PageServerLoad = (event) => {
	const user = requireUser(event);
	const isOwner = user.role === 'owner';
	return {
		now: Date.now(),
		currentUserId: user.id,
		isOwner,
		members: listMembers(db()).map((member) => ({
			id: member.id,
			displayName: member.displayName,
			username: member.username,
			role: member.role,
			deactivated: member.deactivatedAt !== null
		})),
		// Invites are owners' business; members never receive them.
		invites: isOwner
			? listInvites(db()).map((invite) => ({
					id: invite.publicId,
					label: invite.label,
					status: invite.status,
					createdAt: invite.createdAt.getTime(),
					expiresAt: invite.expiresAt.getTime(),
					createdByName: invite.createdByName
				}))
			: []
	};
};

/** Runs an owner action on a member and maps rule violations to form errors. */
async function memberAction(
	event: RequestEvent,
	run: (owner: { id: string }, targetId: string) => void
) {
	const owner = requireOwner(event);
	const parsed = parseForm(target, await event.request.formData());
	if (!parsed.success) return fail(400, { problem: 'not_found' as const });
	try {
		run(owner, parsed.data.id);
	} catch (e) {
		if (e instanceof MemberError) return fail(400, { problem: e.code });
		throw e;
	}
	return { done: true };
}

export const actions: Actions = {
	invite: async (event) => {
		const owner = requireOwner(event);
		const parsed = parseForm(
			z.strictObject({ label: z.string().trim().max(100).optional() }),
			await event.request.formData()
		);
		if (!parsed.success) return fail(400, { problem: 'invalid' as const });
		const { token, publicId } = createInvite(db(), owner.id, parsed.data.label || null);
		audit(db(), 'invite_created', {
			actorId: owner.id,
			ip: clientIp(event),
			details: { invite: publicId }
		});
		// The link is returned once, in this response only.
		return { inviteLink: new URL(`/invite/${token}`, getConfig().origin).href };
	},

	revokeInvite: async (event) => {
		const owner = requireOwner(event);
		const parsed = parseForm(target, await event.request.formData());
		if (!parsed.success || !revokeInvite(db(), parsed.data.id)) {
			return fail(400, { problem: 'not_found' as const });
		}
		audit(db(), 'invite_revoked', {
			actorId: owner.id,
			ip: clientIp(event),
			details: { invite: parsed.data.id }
		});
		return { done: true };
	},

	deactivate: (event) =>
		memberAction(event, (owner, targetId) => {
			deactivateMember(db(), owner.id, targetId);
			audit(db(), 'member_deactivated', {
				actorId: owner.id,
				targetId,
				ip: clientIp(event)
			});
		}),

	reactivate: (event) =>
		memberAction(event, (owner, targetId) => {
			reactivateMember(db(), targetId);
			audit(db(), 'member_reactivated', { actorId: owner.id, targetId, ip: clientIp(event) });
		}),

	setRole: async (event) => {
		const owner = requireOwner(event);
		const parsed = parseForm(
			z.strictObject({ id, role: z.enum(ROLES) }),
			await event.request.formData()
		);
		if (!parsed.success) return fail(400, { problem: 'not_found' as const });
		try {
			setRole(db(), parsed.data.id, parsed.data.role);
		} catch (e) {
			if (e instanceof MemberError) return fail(400, { problem: e.code });
			throw e;
		}
		audit(db(), 'role_changed', {
			actorId: owner.id,
			targetId: parsed.data.id,
			ip: clientIp(event),
			details: { role: parsed.data.role }
		});
		// A change of one's own privileges rotates the session token.
		if (parsed.data.id === owner.id && event.locals.session) {
			deleteSession(db(), event.locals.session.id);
			startSession(event, owner.id);
		}
		return { done: true };
	}
};
