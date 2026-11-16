import { error, redirect, type RequestEvent } from '@sveltejs/kit';
import type { SessionUser } from './session.ts';

/**
 * Per-endpoint checks. `hooks.server.ts` already denies anonymous requests, but every load,
 * action and endpoint calls one of these too, so a mistake in the allowlist cannot expose data.
 */
export function requireUser(event: Pick<RequestEvent, 'locals' | 'url'>): SessionUser {
	const { user, session } = event.locals;
	if (!user || !session || session.mfaPending) {
		redirect(303, `/login?next=${encodeURIComponent(event.url.pathname)}`);
	}
	return user;
}

export function requireOwner(event: Pick<RequestEvent, 'locals' | 'url'>): SessionUser {
	const user = requireUser(event);
	if (user.role !== 'owner') error(403, 'forbidden');
	return user;
}

/** A safe local redirect target from a `next` parameter: same-origin paths only. */
export function safeNext(next: string | null | undefined): string {
	if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
		return '/';
	}
	return next.length > 512 ? '/' : next;
}
