import type { Cookies } from '@sveltejs/kit';
import { getConfig } from '../config.ts';

/**
 * The session cookie. Over HTTPS it carries the `__Host-` prefix, which makes browsers insist on
 * `Secure`, `Path=/` and no `Domain`. Plain HTTP is only possible on localhost (see config).
 */
export function sessionCookieName(): string {
	return isHttps() ? '__Host-herbarium_session' : 'herbarium_session';
}

function isHttps() {
	return getConfig().origin.protocol === 'https:';
}

export function setSessionCookie(cookies: Cookies, token: string, expires: Date): void {
	cookies.set(sessionCookieName(), token, {
		path: '/',
		httpOnly: true,
		secure: isHttps(),
		sameSite: 'lax',
		expires
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(sessionCookieName(), {
		path: '/',
		httpOnly: true,
		secure: isHttps(),
		sameSite: 'lax'
	});
}
