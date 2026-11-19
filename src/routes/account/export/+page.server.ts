import { z } from 'zod';
import { requireUser } from '#lib/server/auth/guard.ts';
import type { PageServerLoad } from './$types';

const problem = z.enum(['password', 'rate', 'busy', 'unavailable']);

export const load: PageServerLoad = (request) => {
	requireUser(request);
	return { problem: problem.safeParse(request.url.searchParams.get('problem')).data };
};
