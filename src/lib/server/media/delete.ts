import { fail, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '#lib/server/app.ts';
import { confirmPassword } from '#lib/server/auth/login.ts';
import { currentPassword, parseForm } from '#lib/server/auth/schemas.ts';
import { clientIp, minutesUntil } from '#lib/server/http/request.ts';

export async function confirmMediaDeletion(event: RequestEvent, actorId: string) {
	const parsed = parseForm(z.strictObject({ currentPassword }), await event.request.formData());
	if (!parsed.success) return fail(400, { problem: 'invalid' as const });
	const check = await confirmPassword(db(), actorId, parsed.data.currentPassword, clientIp(event));
	if (check.ok) return;
	return check.reason === 'rate_limited'
		? fail(429, { problem: 'rate_limited' as const, minutes: minutesUntil(check.retryAfterMs) })
		: fail(400, { problem: 'wrong_password' as const });
}
