import { isHttpError } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';

const FORM_LIMIT = 512 * 1024;

/** The adapter's upload allowance also applies to auth routes. Preserve the smaller form limit. */
export const limitFormBody: Handle = async ({ event, resolve }) => {
	const request = event.request;
	const route = event.route.id;
	const mediaUpload =
		request.method === 'POST' &&
		(route === '/memories/new' ||
			route === '/memories/new/upload' ||
			route === '/memories/import/[id]/upload');
	if (!request.body || mediaUpload) {
		return resolve(event);
	}
	if (Number(request.headers.get('content-length')) > FORM_LIMIT) {
		return new Response(null, { status: 413 });
	}
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > FORM_LIMIT) return new Response(null, { status: 413 });
			chunks.push(value);
		}
	} catch (cause) {
		return new Response(null, { status: isHttpError(cause, 413) ? 413 : 400 });
	} finally {
		reader.releaseLock();
	}
	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.length;
	}
	return resolve({ ...event, request: new Request(request, { body }) });
};
