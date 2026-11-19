import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** A random 256-bit token, base64url encoded (43 characters). */
export function generateToken(): string {
	return randomBytes(32).toString('base64url');
}

/** A random identifier for database rows exposed in URLs (128 bits, base64url). */
export function generateId(): string {
	return randomBytes(16).toString('base64url');
}

/** SHA-256 of a token, hex encoded. Only this hash is ever stored. */
export function hashToken(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time comparison of two strings, e.g. hashes. */
export function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a, 'utf8');
	const right = Buffer.from(b, 'utf8');
	// timingSafeEqual needs equal lengths; comparing against itself keeps the time constant.
	if (left.length !== right.length) {
		timingSafeEqual(left, left);
		return false;
	}
	return timingSafeEqual(left, right);
}

const BASE32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A human-friendly random code from an alphabet without look-alike characters (no 0/O, 1/I),
 * grouped in fours: `ABCD-EFGH-JKLM`. 32 symbols = 5 bits per character.
 */
export function generateHumanCode(length: number): string {
	// 256 is a multiple of 32, so `byte % 32` is unbiased.
	const chars = [...randomBytes(length)].map((byte) => BASE32[byte % 32]);
	return (chars.join('').match(/.{1,4}/g) ?? []).join('-');
}

/** Normalizes user input of a human code: case, spaces and dashes do not matter. */
export function normalizeHumanCode(input: string): string {
	return input.toUpperCase().replace(/[\s-]/g, '');
}
