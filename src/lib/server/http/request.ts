import type { RequestEvent } from '@sveltejs/kit';
import { db } from '../app.ts';
import { setSessionCookie } from '../auth/cookies.ts';
import { createSession } from '../auth/session.ts';

/** The client address as seen by adapter-node (configure `ADDRESS_HEADER` behind a proxy). */
export function clientIp(event: Pick<RequestEvent, 'getClientAddress'>): string {
	try {
		return event.getClientAddress().slice(0, 64);
	} catch {
		return 'unknown';
	}
}

/** Starts a fresh session for the user and sets its cookie. Never reuses an existing token. */
export function startSession(
	event: Pick<RequestEvent, 'cookies' | 'request'>,
	userId: string,
	options: { mfaPending?: boolean } = {}
): void {
	const { token, expiresAt } = createSession(db(), userId, {
		mfaPending: options.mfaPending,
		userAgent: event.request.headers.get('user-agent')
	});
	setSessionCookie(event.cookies, token, expiresAt);
}

export const minutesUntil = (ms: number) => Math.max(1, Math.ceil(ms / 60_000));
