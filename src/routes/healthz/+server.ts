import type { RequestHandler } from './$types';

/** Liveness probe for Docker and reverse proxies. Reveals nothing about the instance. */
export const GET: RequestHandler = () =>
	new Response('ok', { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
