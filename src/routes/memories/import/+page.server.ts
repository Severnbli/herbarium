import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { parseForm } from '#lib/server/auth/schemas.ts';
import { activeImport, startImport } from '#lib/server/media/imports.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (request) => {
	const actor = requireUser(request);
	if (request.url.search) error(400, 'Invalid import request');
	const existing = activeImport(db(), actor.id);
	if (existing) redirect(303, `/memories/import/${existing.id}`);
};

export const actions: Actions = {
	default: async (request) => {
		const actor = requireUser(request);
		if (request.url.search) error(400, 'Invalid import request');
		if (!parseForm(z.strictObject({}), await request.request.formData()).success) {
			return fail(400);
		}
		redirect(303, `/memories/import/${startImport(db(), actor.id)}`);
	}
};
