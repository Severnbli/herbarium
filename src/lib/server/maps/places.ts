import type { Db } from '#lib/server/db/index.ts';
import { savedPlace } from '#lib/server/db/schema.ts';

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
