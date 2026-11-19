import { describe, expect, it } from 'vitest';
import {
	generateHumanCode,
	generateId,
	generateToken,
	hashToken,
	normalizeHumanCode,
	safeEqual
} from './tokens';

describe('tokens', () => {
	it('are 256-bit base64url values and unique', () => {
		const token = generateToken();
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(Buffer.from(token, 'base64url')).toHaveLength(32);
		expect(new Set(Array.from({ length: 100 }, generateToken)).size).toBe(100);
	});

	it('ids are 128-bit base64url values', () => {
		expect(generateId()).toMatch(/^[A-Za-z0-9_-]{22}$/);
	});

	it('hash to SHA-256 hex', () => {
		expect(hashToken('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});

	it('compare in constant time', () => {
		expect(safeEqual('abc', 'abc')).toBe(true);
		expect(safeEqual('abc', 'abd')).toBe(false);
		expect(safeEqual('abc', 'abcd')).toBe(false);
	});

	it('human codes are grouped and normalize back', () => {
		const code = generateHumanCode(12);
		expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
		expect(code).not.toMatch(/[01OI]/);
		expect(normalizeHumanCode(` ${code.toLowerCase()} `)).toBe(code.replaceAll('-', ''));
	});
});
