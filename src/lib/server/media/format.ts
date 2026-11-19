import type { ByteRange } from '#lib/server/http/byte-range.ts';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { DecryptionError, KEY_BYTES } from '#lib/server/crypto/keys.ts';

export const SEGMENT_BYTES = 256 * 1024;
const TAG_BYTES = 16;
const MAGIC = Buffer.from('HMEDIA\x01\0');
const HEADER_BYTES = 24;
const MAX_BYTES = SEGMENT_BYTES * (2 ** 32 - 1);

function nonce(header: Buffer, counter: number): Buffer {
	const value = Buffer.alloc(12);
	header.copy(value, 0, 8, 16);
	value.writeUInt32BE(counter, 8);
	return value;
}

function encrypt(key: Buffer, header: Buffer, counter: number, plaintext: Buffer): Buffer {
	const cipher = createCipheriv('aes-256-gcm', key, nonce(header, counter), {
		authTagLength: TAG_BYTES
	});
	cipher.setAAD(header);
	return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

function decrypt(key: Buffer, header: Buffer, counter: number, sealed: Buffer): Buffer {
	try {
		const decipher = createDecipheriv('aes-256-gcm', key, nonce(header, counter), {
			authTagLength: TAG_BYTES
		});
		decipher.setAAD(header);
		decipher.setAuthTag(sealed.subarray(-TAG_BYTES));
		return Buffer.concat([decipher.update(sealed.subarray(0, -TAG_BYTES)), decipher.final()]);
	} catch {
		throw new DecryptionError();
	}
}

async function write(file: FileHandle, bytes: Buffer): Promise<void> {
	let offset = 0;
	while (offset < bytes.length) {
		const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset);
		if (!bytesWritten) throw new Error('Incomplete media write');
		offset += bytesWritten;
	}
}

async function read(file: FileHandle, length: number, position: number): Promise<Buffer> {
	const bytes = Buffer.allocUnsafe(length);
	let offset = 0;
	while (offset < length) {
		const { bytesRead } = await file.read(bytes, offset, length - offset, position + offset);
		if (!bytesRead) throw new DecryptionError();
		offset += bytesRead;
	}
	return bytes;
}

/** Each new file requires a fresh data key. Counter zero authenticates the header. */
export async function encryptMedia(
	file: FileHandle,
	key: Buffer,
	size: number,
	source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>
): Promise<void> {
	if (!Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES || key.length !== KEY_BYTES) {
		throw new Error('Invalid media size or key');
	}
	const header = Buffer.alloc(HEADER_BYTES);
	MAGIC.copy(header);
	randomBytes(8).copy(header, 8);
	header.writeBigUInt64BE(BigInt(size), 16);
	await write(file, Buffer.concat([header, encrypt(key, header, 0, Buffer.alloc(0))]));

	const segment = Buffer.allocUnsafe(SEGMENT_BYTES);
	let received = 0;
	let used = 0;
	let counter = 1;
	for await (const bytes of source) {
		received += bytes.length;
		if (received > size) throw new Error('Media size changed during write');
		let offset = 0;
		while (offset < bytes.length) {
			const count = Math.min(bytes.length - offset, SEGMENT_BYTES - used);
			segment.set(bytes.subarray(offset, offset + count), used);
			used += count;
			offset += count;
			if (used === SEGMENT_BYTES) {
				await write(file, encrypt(key, header, counter++, segment));
				used = 0;
			}
		}
	}
	if (received !== size) throw new Error('Media size changed during write');
	if (used) await write(file, encrypt(key, header, counter, segment.subarray(0, used)));
}

/** Authenticate size and version before trusting offsets or HTTP response lengths. */
export async function openMedia(file: FileHandle, key: Buffer, expectedSize: number) {
	const sealed = await read(file, HEADER_BYTES + TAG_BYTES, 0);
	const header = sealed.subarray(0, HEADER_BYTES);
	decrypt(key, header, 0, sealed.subarray(HEADER_BYTES));
	if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new DecryptionError();
	const size = Number(header.readBigUInt64BE(16));
	if (size < 1 || size > MAX_BYTES || size !== expectedSize) throw new DecryptionError();
	const segments = Math.ceil(size / SEGMENT_BYTES);
	if ((await file.stat()).size !== HEADER_BYTES + TAG_BYTES + size + segments * TAG_BYTES) {
		throw new DecryptionError();
	}

	return async function* ({ start, end }: ByteRange) {
		if (start < 0 || end < start || end >= size) throw new RangeError('Invalid media range');
		const first = Math.floor(start / SEGMENT_BYTES);
		const last = Math.floor(end / SEGMENT_BYTES);
		for (let index = first; index <= last; index++) {
			const segmentStart = index * SEGMENT_BYTES;
			const offset = HEADER_BYTES + TAG_BYTES + index * (SEGMENT_BYTES + TAG_BYTES);
			const length = Math.min(size - segmentStart, SEGMENT_BYTES);
			const ciphertext = await read(file, length + TAG_BYTES, offset);
			const bytes = decrypt(key, header, index + 1, ciphertext);
			yield bytes.subarray(Math.max(0, start - segmentStart), end - segmentStart + 1);
		}
	};
}
