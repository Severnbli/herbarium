import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	DecryptionError,
	deriveKey,
	deriveKeys,
	generateDataKey,
	open,
	seal,
	unwrapDataKey,
	wrapDataKey
} from './keys';

const master = randomBytes(32);

describe('deriveKey', () => {
	it('is deterministic per purpose and differs between purposes', () => {
		expect(deriveKey(master, 'database')).toEqual(deriveKey(master, 'database'));
		const keys = deriveKeys(master);
		const hex = [keys.database, keys.keyWrap, keys.field, master].map((k) => k.toString('hex'));
		expect(new Set(hex).size).toBe(4);
		expect(keys.database).toHaveLength(32);
	});

	it('depends on the master key', () => {
		expect(deriveKey(master, 'field')).not.toEqual(deriveKey(randomBytes(32), 'field'));
	});

	it('rejects keys of the wrong size', () => {
		expect(() => deriveKey(randomBytes(16), 'field')).toThrow();
	});
});

describe('seal / open', () => {
	const key = deriveKey(master, 'field');
	const plaintext = Buffer.from('a private note');

	it('round-trips', () => {
		expect(open(key, seal(key, plaintext, 'ctx'), 'ctx')).toEqual(plaintext);
	});

	it('uses a fresh nonce every time', () => {
		expect(seal(key, plaintext, 'ctx')).not.toEqual(seal(key, plaintext, 'ctx'));
	});

	it('does not contain the plaintext', () => {
		expect(seal(key, plaintext, 'ctx').includes(plaintext)).toBe(false);
	});

	it('rejects a wrong key, a wrong context and any flipped bit', () => {
		const sealed = seal(key, plaintext, 'ctx');
		expect(() => open(randomBytes(32), sealed, 'ctx')).toThrow(DecryptionError);
		expect(() => open(key, sealed, 'other')).toThrow(DecryptionError);
		for (let i = 0; i < sealed.length; i++) {
			const tampered = Buffer.from(sealed);
			tampered[i] = (tampered[i] as number) ^ 0x01;
			expect(() => open(key, tampered, 'ctx')).toThrow(DecryptionError);
		}
	});

	it('rejects truncated input', () => {
		expect(() => open(key, Buffer.alloc(10), 'ctx')).toThrow(DecryptionError);
	});
});

describe('data keys', () => {
	const wrappingKey = deriveKey(master, 'key-wrap');

	it('are random 256-bit keys', () => {
		const a = generateDataKey();
		expect(a).toHaveLength(32);
		expect(a).not.toEqual(generateDataKey());
	});

	it('wrap and unwrap bound to their record', () => {
		const dataKey = generateDataKey();
		const wrapped = wrapDataKey(wrappingKey, dataKey, 'media:abc');
		expect(wrapped.includes(dataKey)).toBe(false);
		expect(unwrapDataKey(wrappingKey, wrapped, 'media:abc')).toEqual(dataKey);
		expect(() => unwrapDataKey(wrappingKey, wrapped, 'media:xyz')).toThrow(DecryptionError);
	});
});
