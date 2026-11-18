import { randomUUID } from 'node:crypto';
import { building, dev } from '$app/env';
import { redirect } from '@sveltejs/kit';
import {
	sequence,
	type Handle,
	type HandleServerError,
	type ServerInit
} from '@sveltejs/kit/hooks';
import { isLocale, negotiateLocale } from '#lib/i18n/index.ts';
import { db, initApp, isSetupDone } from '#lib/server/app.ts';
import { clearSessionCookie, sessionCookieName } from '#lib/server/auth/cookies.ts';
import { validateSession } from '#lib/server/auth/session.ts';
import { ConfigError, getConfig, initConfig } from '#lib/server/config.ts';
import { DatabaseKeyError } from '#lib/server/db/index.ts';
import { limitFormBody } from '#lib/server/http/body-limit.ts';
import { isPublicPath, MFA_PATHS, securityHeaders } from '#lib/server/http/security.ts';

export const init: ServerInit = () => {
	if (building) return;

	try {
		initConfig(process.env, { production: !dev });
		initApp();
	} catch (error) {
		if (error instanceof ConfigError || error instanceof DatabaseKeyError) {
			// These messages name variables and rules only, never secret values.
			console.error(error.message);
			process.exit(1);
		}
		throw error;
	}
};

const locale: Handle = ({ event, resolve }) => {
	const preference = event.locals.user?.locale;
	event.locals.locale = isLocale(preference)
		? preference
		: negotiateLocale(event.request.headers.get('accept-language'));
	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%lang%', event.locals.locale)
	});
};

const authenticate: Handle = ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.session = null;
	const token = event.cookies.get(sessionCookieName());
	if (token) {
		const session = validateSession(db(), token);
		if (session) {
			event.locals.session = { id: session.id, mfaPending: session.mfaPending };
			if (!session.mfaPending) event.locals.user = session.user;
		} else {
			clearSessionCookie(event.cookies);
		}
	}
	return resolve(event);
};

/** Deny by default: only the explicit allowlist is reachable without a full session. */
const guard: Handle = ({ event, resolve }) => {
	const path = event.url.pathname;
	if (path === '/healthz') return resolve(event);

	const wantsPage = event.request.method === 'GET' || event.request.method === 'HEAD';
	const deny = (location: string) =>
		wantsPage ? redirect(303, location) : new Response('Unauthorized', { status: 401 });

	if (!isSetupDone()) {
		return path === '/setup' ? resolve(event) : deny('/setup');
	}
	if (event.locals.session?.mfaPending) {
		return MFA_PATHS.has(path) ? resolve(event) : deny('/login/verify');
	}
	if (!event.locals.user && !isPublicPath(path)) {
		const next = path === '/' ? '' : `?next=${encodeURIComponent(path)}`;
		return deny(`/login${next}`);
	}
	return resolve(event);
};

const headers: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	const https = getConfig().origin.protocol === 'https:';
	for (const [name, value] of Object.entries(securityHeaders(https))) {
		response.headers.set(name, value);
	}
	// Pages hold private data: never let browsers or proxies keep a copy.
	if (!response.headers.has('cache-control')) {
		response.headers.set('cache-control', 'no-store');
	}
	return response;
};

export const handle = sequence(headers, authenticate, locale, guard, limitFormBody);

/**
 * Only unexpected errors reach the log, with a reference id shown on the error page. The response
 * never carries the message, stack, SQL or paths.
 */
export const handleError: HandleServerError = (input) => {
	if (input.kind !== 'unknown') return;
	const { error } = input;
	const id = randomUUID();
	// Query errors can carry bound values in their message, so log the underlying driver error.
	const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
	const summary = cause instanceof Error ? `${cause.name}: ${cause.message}` : 'non-Error thrown';
	const stack = error instanceof Error ? (error.stack?.split('\n').slice(1).join('\n') ?? '') : '';
	console.error(`[${id}] ${summary}\n${stack}`);
	return { message: 'Internal Error', id };
};
