import { desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from '#lib/server/db/index.ts';
import { event, memory } from '#lib/server/db/schema.ts';

export function latestEventAttachment(db: Db) {
	const attachment = alias(memory, 'attachment');
	return db
		.select({ id: attachment.id })
		.from(attachment)
		.where(eq(attachment.eventId, event.id))
		.orderBy(desc(attachment.sortDate), desc(attachment.id))
		.limit(1);
}
