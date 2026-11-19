import { encode } from 'uqr';

/**
 * Encodes text as a QR code and returns it as one SVG path, so the page can draw it without
 * `{@html}` and without any image request. Rendered on the server; the secret never leaves it
 * except in this response.
 */
export function qrPath(text: string): { size: number; path: string } {
	const { data, size } = encode(text, { ecc: 'M', border: 4 });
	let path = '';
	data.forEach((row, y) =>
		row.forEach((dark, x) => {
			if (dark) path += `M${x} ${y}h1v1h-1z`;
		})
	);
	return { size, path };
}
