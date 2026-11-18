import { opendirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from '#lib/server/db/index.ts';
import { mediaFile } from '#lib/server/db/schema.ts';
import { mediaId } from './store.ts';

/** Recover encrypted files left between a filesystem write or unlink and its database change. */
export function cleanOrphanMedia(db: Db, dataDir: string): void {
	const path = join(dataDir, 'media');
	let directory: ReturnType<typeof opendirSync>;
	try {
		directory = opendirSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
		throw new Error('Media directory unavailable', { cause: error });
	}
	try {
		for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
			if (!entry.isFile() || !mediaId.safeParse(entry.name).success) continue;
			if (
				db.select({ id: mediaFile.id }).from(mediaFile).where(eq(mediaFile.id, entry.name)).get()
			) {
				continue;
			}
			try {
				unlinkSync(join(path, entry.name));
			} catch {
				console.error('Herbarium could not remove an unused encrypted media file.');
			}
		}
	} finally {
		directory.closeSync();
	}
}
