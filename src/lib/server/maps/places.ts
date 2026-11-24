import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '#lib/server/db/index.ts';
import { event, eventPlace, savedPlace } from '#lib/server/db/schema.ts';

export function listSavedPlaces(db: Db) {
	return db
		.select({
			id: savedPlace.id,
			place: savedPlace.place,
			lat: savedPlace.lat,
			lon: savedPlace.lon
		})
		.from(savedPlace)
		.orderBy(savedPlace.place, savedPlace.id)
		.all();
}

export function updateSavedPlace(
	db: Db,
	id: string,
	values: Pick<typeof savedPlace.$inferInsert, 'place' | 'lat' | 'lon'>
) {
	return db.transaction((tx) => {
		if (!tx.update(savedPlace).set(values).where(eq(savedPlace.id, id)).run().changes) return false;
		tx.update(event)
			.set({ place: values.place })
			.where(and(eq(event.savedPlaceId, id), ne(event.place, values.place)))
			.run();
		tx.update(eventPlace)
			.set({ place: values.place })
			.where(and(eq(eventPlace.savedPlaceId, id), ne(eventPlace.place, values.place)))
			.run();
		return true;
	});
}
