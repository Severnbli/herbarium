import { join } from 'node:path';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { z } from 'zod';
import type { Locale } from '#lib/i18n/index.ts';
import { mapAssetDir } from './assets.ts';
import type { GazetteerPlace } from '#lib/domain/location.ts';

export const placeSearch = z.strictObject({
	q: z.string().trim().min(2).max(100)
});

type GazetteerRow = Omit<GazetteerPlace, 'name'> & {
	label: string;
	ascii_label: string;
	be: string | null;
	en: string | null;
	ru: string | null;
};

let gazetteer: ReturnType<typeof drizzle> | undefined;

export function searchPlaces(input: string, locale: Locale): GazetteerPlace[] {
	const tokens = input.normalize('NFC').match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu);
	if (!tokens?.length) return [];
	const match = tokens.map((token) => `"${token}"*`).join(' AND ');
	gazetteer ??= drizzle({
		client: new Database(join(mapAssetDir, 'gazetteer.sqlite'), { readonly: true })
	});
	const rows = gazetteer.all<GazetteerRow>(sql`
		SELECT place.*
		FROM place_fts JOIN place ON place.id = place_fts.rowid
		WHERE place_fts MATCH ${match}
		ORDER BY population DESC, rank, place.id
		LIMIT 10
	`);
	return rows.map(({ id, lat, lon, country, label, ascii_label, ...names }) => ({
		id,
		lat,
		lon,
		country,
		name: names[locale] ?? (locale === 'en' ? ascii_label : label)
	}));
}
