import { error, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { db, keys } from '#lib/server/app.ts';
import { createExport } from '#lib/server/archive/export.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { confirmPassword } from '#lib/server/auth/login.ts';
import { currentPassword, parseForm } from '#lib/server/auth/schemas.ts';
import { validateSession } from '#lib/server/auth/session.ts';
import { sessionCookieName } from '#lib/server/auth/cookies.ts';
import { getConfig } from '#lib/server/config.ts';
import { clientIp } from '#lib/server/http/request.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (request) => {
	const actor = requireUser(request);
	if (request.url.search) error(400, 'Invalid export request');
	const contentType = request.request.headers.get('content-type');
	if (!contentType?.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
		error(415, 'Expected an export form');
	}
	const parsed = parseForm(z.strictObject({ currentPassword }), await request.request.formData());
	if (!parsed.success) redirect(303, '/account/export?problem=password');
	const ip = clientIp(request);
	const check = await confirmPassword(db(), actor.id, parsed.data.currentPassword, ip);
	if (!check.ok) {
		redirect(
			303,
			`/account/export?problem=${check.reason === 'rate_limited' ? 'rate' : 'password'}`
		);
	}
	const session = validateSession(db(), request.cookies.get(sessionCookieName()) ?? '');
	if (session?.id !== request.locals.session?.id || session?.user.id !== actor.id) {
		error(401, 'Session ended');
	}
	let stream: ReturnType<typeof createExport>;
	try {
		stream = createExport(
			db(),
			getConfig().dataDir,
			keys().keyWrap,
			actor.id,
			ip,
			request.request.signal
		);
	} catch {
		redirect(303, '/account/export?problem=unavailable');
	}
	if (!stream) redirect(303, '/account/export?problem=busy');
	return new Response(stream, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': 'attachment; filename="herbarium-export.zip"',
			'Cache-Control': 'no-store'
		}
	});
};
