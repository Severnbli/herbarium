import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyDummy, verifyPassword } from './password';

describe('password hashing', () => {
	it('uses argon2id with at least the OWASP parameters', async () => {
		const hash = await hashPassword('correct horse battery staple');
		const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=\d+\$/.exec(hash);
		expect(match).not.toBeNull();
		expect(Number(match?.[1])).toBeGreaterThanOrEqual(19 * 1024);
		expect(Number(match?.[2])).toBeGreaterThanOrEqual(2);
		expect(hash).not.toContain('correct horse');
		expect(needsRehash(hash)).toBe(false);
	});

	it('verifies the right password only', async () => {
		const hash = await hashPassword('correct horse battery staple');
		expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
		expect(await verifyPassword(hash, 'Correct horse battery staple')).toBe(false);
	});

	it('treats malformed hashes as a mismatch', async () => {
		expect(await verifyPassword('not a hash', 'x')).toBe(false);
		expect(await verifyDummy('x')).toBe(false);
	});

	it('flags weaker hashes for rehashing', () => {
		expect(needsRehash('$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaA')).toBe(true);
		expect(needsRehash('$2b$10$abcdefghijklmnopqrstuv')).toBe(true);
	});
});
