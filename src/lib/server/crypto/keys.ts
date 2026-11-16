import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Key management.
 *
 * The master key never encrypts data directly. Purpose-bound subkeys are derived from it with
 * HKDF-SHA256, so one compromised use cannot be turned against another:
 *
 * - `database`  – the raw SQLCipher key of the SQLite file
 * - `key-wrap`  – wraps the random per-file data keys of media (phase 5)
 * - `field`     – encrypts individual secret columns, such as TOTP secrets
 *
 * Wrapped values use AES-256-GCM with a fresh random 96-bit nonce and are bound to their context
 * through additional authenticated data, so a wrapped key cannot be moved to another record.
 * Rotation is described in `docs/key-management.md`.
 */

export const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
/** First byte of every sealed value; lets a future format coexist with this one. */
const FORMAT_V1 = 0x01;

export type KeyPurpose = 'database' | 'key-wrap' | 'field';

const HKDF_SALT = Buffer.from('herbarium/hkdf-salt/v1');

export function deriveKey(masterKey: Buffer, purpose: KeyPurpose): Buffer {
	assertKey(masterKey);
	return Buffer.from(
		hkdfSync('sha256', masterKey, HKDF_SALT, `herbarium/v1/${purpose}`, KEY_BYTES)
	);
}

/** A fresh random 256-bit key, e.g. the data key of one media file. */
export function generateDataKey(): Buffer {
	return randomBytes(KEY_BYTES);
}

export class DecryptionError extends Error {
	constructor() {
		super('Decryption failed: wrong key, wrong context or tampered data');
		this.name = 'DecryptionError';
	}
}

/**
 * Encrypts `plaintext` with AES-256-GCM. Layout: version (1) | nonce (12) | ciphertext | tag (16).
 * `context` is authenticated but not stored; the same context is required to open the value.
 */
export function seal(key: Buffer, plaintext: Buffer, context: string): Buffer {
	assertKey(key);
	const nonce = randomBytes(NONCE_BYTES);
	const header = Buffer.from([FORMAT_V1]);
	const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
	cipher.setAAD(Buffer.concat([header, Buffer.from(context, 'utf8')]));
	const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	return Buffer.concat([header, nonce, ciphertext, cipher.getAuthTag()]);
}

/** Opens a value produced by `seal`. Throws `DecryptionError` unless the tag verifies. */
export function open(key: Buffer, sealed: Buffer, context: string): Buffer {
	assertKey(key);
	if (sealed.length < 1 + NONCE_BYTES + TAG_BYTES || sealed[0] !== FORMAT_V1) {
		throw new DecryptionError();
	}
	const header = sealed.subarray(0, 1);
	const nonce = sealed.subarray(1, 1 + NONCE_BYTES);
	const tag = sealed.subarray(sealed.length - TAG_BYTES);
	const ciphertext = sealed.subarray(1 + NONCE_BYTES, sealed.length - TAG_BYTES);
	try {
		const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
		decipher.setAAD(Buffer.concat([header, Buffer.from(context, 'utf8')]));
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	} catch {
		throw new DecryptionError();
	}
}

/** Wraps a data key with the `key-wrap` subkey, bound to the record it belongs to. */
export function wrapDataKey(wrappingKey: Buffer, dataKey: Buffer, context: string): Buffer {
	assertKey(dataKey);
	return seal(wrappingKey, dataKey, `data-key:${context}`);
}

export function unwrapDataKey(wrappingKey: Buffer, wrapped: Buffer, context: string): Buffer {
	const dataKey = open(wrappingKey, wrapped, `data-key:${context}`);
	assertKey(dataKey);
	return dataKey;
}

function assertKey(key: Buffer) {
	if (key.length !== KEY_BYTES) {
		throw new Error(`Expected a ${KEY_BYTES}-byte key`);
	}
}

/** The subkeys used by the running server, derived once from the configured master key. */
export interface Keys {
	database: Buffer;
	keyWrap: Buffer;
	field: Buffer;
}

export function deriveKeys(masterKey: Buffer): Keys {
	return {
		database: deriveKey(masterKey, 'database'),
		keyWrap: deriveKey(masterKey, 'key-wrap'),
		field: deriveKey(masterKey, 'field')
	};
}
