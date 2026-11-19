import { version } from '$app/env';
import { immutable } from '$app/manifest';
import { self } from '$app/service-worker';

const prefix = 'herbarium-assets-';
const cacheName = `${prefix}${version}`;
// Exact URLs from the client build. The manifest of static files and the route manifest
// are deliberately excluded, so dynamic responses never enter Cache Storage.
const assets = new Set(immutable.map(({ path }) => new URL(path, self.registration.scope).href));

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((names) =>
				Promise.all(
					names
						.filter((name) => name.startsWith(prefix) && name !== cacheName)
						.map((name) => caches.delete(name))
				)
			)
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (
		request.method !== 'GET' ||
		request.mode === 'navigate' ||
		request.headers.has('range') ||
		!assets.has(request.url)
	) {
		return;
	}
	event.respondWith(loadAsset(request.url));
});

async function loadAsset(url: string): Promise<Response> {
	const cache = await caches.open(cacheName).catch(() => undefined);
	const cached = await cache?.match(url).catch(() => undefined);
	if (cached) return cached;

	const response = await fetch(url, { credentials: 'omit', redirect: 'error' });
	const directives = response.headers
		.get('cache-control')
		?.toLowerCase()
		.split(/\s*,\s*/);
	if (
		response.status === 200 &&
		directives?.includes('public') &&
		directives.includes('immutable') &&
		!directives.includes('private') &&
		!directives.includes('no-store')
	) {
		await cache?.put(url, response.clone()).catch(() => undefined);
	}
	return response;
}
