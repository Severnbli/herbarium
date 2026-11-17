import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { LOCALES, type Locale } from '#lib/i18n/index.ts';
import type { Db } from '../db/index.ts';
import { user } from '../db/schema.ts';

export const localeSchema = z.strictObject({ locale: z.enum(LOCALES) });

/** Only the authenticated member's own preference may be changed. */
export function updateLocale(db: Db, userId: string, locale: Locale): void {
	db.update(user).set({ locale }).where(eq(user.id, userId)).run();
}
