import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { db, keys } from '#lib/server/app.ts';
import { requireUser } from '#lib/server/auth/guard.ts';
import { parseForm } from '#lib/server/auth/schemas.ts';
import { getConfig } from '#lib/server/config.ts';
import { hasBasemap } from '#lib/server/maps/assets.ts';
import { requireNoQuery, routeMediaId } from '#lib/server/media/gallery.ts';
import {
	finishImport,
	groupFields,
	ImportError,
	importGroups,
	MAX_IMPORT_FILES,
	organizeImport,
	requireImport
} from '#lib/server/media/imports.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (request) => {
	const actor = requireUser(request);
	requireNoQuery(request, ['/organize', '/finish']);
	const id = routeMediaId(request.params);
	try {
		requireImport(db(), id, actor.id);
	} catch (cause) {
		if (cause instanceof ImportError) error(404, 'Import unavailable');
		throw cause;
	}
	const config = getConfig();
	return {
		id,
		groups: importGroups(db(), id),
		maxFiles: MAX_IMPORT_FILES,
		maxFileBytes: config.limits.maxFileBytes,
		basemap: await hasBasemap(config.dataDir)
	};
};

export const actions: Actions = {
	organize: async (request) => {
		const actor = requireUser(request);
		requireNoQuery(request, ['/organize']);
		const id = routeMediaId(request.params);
		const parsed = parseForm(groupFields, await request.request.formData());
		if (!parsed.success) return fail(400, { problem: 'invalid' as const });
		try {
			const created = organizeImport(db(), id, actor.id, parsed.data, {
				key: keys().field,
				sessionId: request.locals.session!.id
			});
			return { created };
		} catch (cause) {
			if (cause instanceof ImportError) {
				return fail(409, {
					problem: cause.code === 'coordinates' ? ('coordinates' as const) : ('changed' as const)
				});
			}
			throw cause;
		}
	},
	finish: async (request) => {
		const actor = requireUser(request);
		requireNoQuery(request, ['/finish']);
		const id = routeMediaId(request.params);
		const parsed = parseForm(z.strictObject({}), await request.request.formData());
		if (!parsed.success) return fail(400, { problem: 'invalid' as const });
		finishImport(db(), id, actor.id);
		redirect(303, '/memories');
	}
};
