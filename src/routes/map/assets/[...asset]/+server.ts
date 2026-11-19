import { requireUser } from '#lib/server/auth/guard.ts';
import { getConfig } from '#lib/server/config.ts';
import { mapAssetResponse } from '#lib/server/maps/assets.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
	requireUser(event);
	return mapAssetResponse(event.request, getConfig().dataDir, event.params);
};

export const HEAD = GET;
