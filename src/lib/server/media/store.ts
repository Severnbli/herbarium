import { constants } from 'node:fs';
import { mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { generateDataKey, wrapDataKey } from '#lib/server/crypto/keys.ts';
import { generateId } from '#lib/server/crypto/tokens.ts';
import { encryptMedia } from './format.ts';

export const mediaId = z.string().regex(/^[A-Za-z0-9_-]{22}$/);

function mediaPath(dataDir: string, id: string): string {
	return join(dataDir, 'media', mediaId.parse(id));
}

export function openMediaFile(dataDir: string, id: string) {
	return open(mediaPath(dataDir, id), constants.O_RDONLY | constants.O_NOFOLLOW);
}

// Keep an archive snapshot readable if a member deletes a memory during the download.
const heldFiles = new Map<string, { deleted: boolean }>();

export function holdMediaFiles(dataDir: string, ids: string[]): () => void {
	const paths = ids.map((id) => mediaPath(dataDir, id));
	for (const path of paths) heldFiles.set(path, { deleted: false });
	return () => {
		for (const path of paths) {
			const held = heldFiles.get(path);
			heldFiles.delete(path);
			if (held?.deleted) {
				void unlink(path).catch(() => {
					console.error('Herbarium could not remove an unused encrypted media file.');
				});
			}
		}
	};
}

export async function removeMediaFile(dataDir: string, id: string): Promise<void> {
	const path = mediaPath(dataDir, id);
	const held = heldFiles.get(path);
	if (held) {
		held.deleted = true;
		return;
	}
	try {
		await unlink(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
}

export async function storeMediaFile(
	dataDir: string,
	wrappingKey: Buffer,
	size: number,
	bytes: AsyncIterable<Uint8Array> | Iterable<Uint8Array>
): Promise<{ id: string; size: number; wrappedKey: Buffer }> {
	const dir = join(dataDir, 'media');
	const created = await mkdir(dir, { recursive: true, mode: 0o700 });
	const id = generateId();
	const dataKey = generateDataKey();
	const wrappedKey = wrapDataKey(wrappingKey, dataKey, `media:${id}`);
	const file = await open(mediaPath(dataDir, id), 'wx', 0o600);
	try {
		try {
			await encryptMedia(file, dataKey, size, bytes);
			await file.sync();
		} finally {
			await file.close();
		}
		await syncDirectory(dir);
		if (created) await syncDirectory(dataDir);
	} catch (cause) {
		await removeMediaFile(dataDir, id);
		throw cause;
	} finally {
		dataKey.fill(0);
	}
	return { id, size, wrappedKey };
}

async function syncDirectory(path: string) {
	const directory = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
	try {
		await directory.sync();
	} finally {
		await directory.close();
	}
}
