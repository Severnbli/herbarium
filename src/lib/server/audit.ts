import type { Db } from './db/index.ts';
import { auditLog, type AuditEvent } from './db/schema.ts';

export interface AuditEntry {
	actorId?: string | null;
	targetId?: string | null;
	ip?: string | null;
	/** Non-secret details only: never passwords, tokens, keys or content. */
	details?: Record<string, string | number | boolean>;
}

/** Records a security event in the audit table. */
export function audit(db: Db, event: AuditEvent, entry: AuditEntry = {}, now = new Date()): void {
	db.insert(auditLog)
		.values({
			createdAt: now,
			event,
			actorId: entry.actorId ?? null,
			targetId: entry.targetId ?? null,
			ip: entry.ip ?? null,
			details: entry.details ?? null
		})
		.run();
}
