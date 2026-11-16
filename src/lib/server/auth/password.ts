import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id with the RFC 9106 "second recommended" parameters (64 MiB, 3 passes), well above the
 * OWASP minimum of 19 MiB and 2 passes.
 */
const PARAMS = {
	// `Algorithm.Argon2id`; the enum is a `const enum`, which isolated modules cannot import.
	algorithm: 2,
	memoryCost: 64 * 1024,
	timeCost: 3,
	parallelism: 1
} as const;

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../domain/password.ts';

export function hashPassword(password: string): Promise<string> {
	return hash(password, PARAMS);
}

/** Never throws on a malformed hash; it simply does not match. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
	try {
		return await verify(passwordHash, password);
	} catch {
		return false;
	}
}

/** True when a stored hash was made with weaker parameters than the current ones. */
export function needsRehash(passwordHash: string): boolean {
	const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(passwordHash);
	if (!match) return true;
	const [, m, t, p] = match.map(Number);
	return m !== PARAMS.memoryCost || t !== PARAMS.timeCost || p !== PARAMS.parallelism;
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifies against a throwaway hash, so a login for an unknown account costs as much time as a
 * real one and response timing does not reveal which accounts exist.
 */
export async function verifyDummy(password: string): Promise<false> {
	dummyHash ??= hashPassword('herbarium-timing-equalizer');
	await verifyPassword(await dummyHash, password);
	return false;
}
