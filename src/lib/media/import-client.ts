import type { Coordinates } from '#lib/domain/location.ts';

export type LocationSuggestion = Coordinates & { token: string };
type UploadReply =
	| { status: 'ready' | 'saved' | 'duplicate' }
	| { status: 'uploaded'; id: string; suggestion: LocationSuggestion | null }
	| {
			problem:
				| 'invalid'
				| 'size'
				| 'unsupported'
				| 'busy'
				| 'unavailable'
				| 'missing'
				| 'full'
				| 'session';
	  };

const CHUNK_BYTES = 4 * 1024 * 1024;
export const mediaAccept =
	'image/jpeg,image/png,image/heic,video/mp4,video/quicktime,.jpg,.jpeg,.png,.heic,.mp4,.mov';

/** Identify the same selection after reload without reading a large video into one buffer. */
export async function localFingerprint(file: File, signal: AbortSignal) {
	const chunks = new Uint8Array(Math.ceil(file.size / CHUNK_BYTES) * 32);
	for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
		signal.throwIfAborted();
		const bytes = await file.slice(offset, offset + CHUNK_BYTES).arrayBuffer();
		const digest = await crypto.subtle.digest('SHA-256', bytes);
		chunks.set(new Uint8Array(digest), (offset / CHUNK_BYTES) * 32);
	}
	signal.throwIfAborted();
	const fingerprint = await crypto.subtle.digest('SHA-256', chunks);
	return Array.from(new Uint8Array(fingerprint), (byte) => byte.toString(16).padStart(2, '0')).join(
		''
	);
}

export async function checkReceipt(
	url: string,
	fingerprint: string,
	signal: AbortSignal
): Promise<UploadReply> {
	const response = await fetch(url, {
		headers: { 'X-Herbarium-Upload': fingerprint },
		redirect: 'error',
		signal
	});
	return (await response.json()) as UploadReply;
}

export function sendMediaFile(
	url: string,
	file: File,
	fingerprint: string,
	signal: AbortSignal,
	progress: (fraction: number) => void
): Promise<UploadReply> {
	return new Promise((resolve, reject) => {
		signal.throwIfAborted();
		const request = new XMLHttpRequest();
		const abort = () => request.abort();
		request.open('POST', url);
		request.responseType = 'json';
		request.timeout = 7 * 60_000;
		request.setRequestHeader('X-Herbarium-Upload', fingerprint);
		request.upload.onprogress = (event) => {
			if (event.lengthComputable) progress(event.loaded / event.total);
		};
		request.onload = () => {
			if (request.response) resolve(request.response as UploadReply);
			else reject(new Error('Invalid upload response'));
		};
		request.onerror =
			request.onabort =
			request.ontimeout =
				() => reject(new Error('Upload interrupted'));
		request.onloadend = () => signal.removeEventListener('abort', abort);
		signal.addEventListener('abort', abort, { once: true });
		const body = new FormData();
		body.append('file', file);
		body.append('altText', '');
		body.append('caption', '');
		request.send(body);
	});
}
