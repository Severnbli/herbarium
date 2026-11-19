import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { open, seal } from '#lib/server/crypto/keys.ts';
import type { Db } from '#lib/server/db/index.ts';
import { event, memory } from '#lib/server/db/schema.ts';
import { mediaId } from './store.ts';

const suggestion = z.strictObject({
	id: mediaId,
	lat: z.number().min(-90).max(90),
	lon: z.number().min(-180).max(180),
	expires: z.int()
});

export function offerCoordinates(
	key: Buffer,
	sessionId: string,
	id: string,
	coordinates: { lat: number; lon: number }
) {
	const data = Buffer.from(
		JSON.stringify({ id, ...coordinates, expires: Date.now() + 30 * 60_000 })
	);
	return seal(key, data, `media-coordinates:${sessionId}`).toString('base64url');
}

export function acceptCoordinates(
	db: Db,
	key: Buffer,
	sessionId: string,
	id: string,
	token: string
): boolean {
	let parsed: z.infer<typeof suggestion>;
	try {
		parsed = suggestion.parse(
			JSON.parse(
				open(key, Buffer.from(token, 'base64url'), `media-coordinates:${sessionId}`).toString(
					'utf8'
				)
			)
		);
	} catch {
		return false;
	}
	if (parsed.id !== id || parsed.expires <= Date.now()) return false;
	return db.transaction((tx) => {
		const row = tx.select({ eventId: memory.eventId }).from(memory).where(eq(memory.id, id)).get();
		if (!row?.eventId) return false;
		return (
			tx
				.update(event)
				.set({ lat: parsed.lat, lon: parsed.lon, updatedAt: new Date() })
				.where(and(eq(event.id, row.eventId), isNull(event.lat), isNull(event.lon)))
				.run().changes === 1
		);
	});
}
