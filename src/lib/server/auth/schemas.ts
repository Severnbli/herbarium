import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './password.ts';

/** Login names: lowercase letters, digits, `.`, `_`, `-`; compared case-insensitively. */
export const username = z
	.string()
	.trim()
	.toLowerCase()
	.min(3)
	.max(32)
	.regex(/^[a-z0-9][a-z0-9._-]*$/);

export const displayName = z.string().trim().min(1).max(64);

/** A new password. Only the length is checked, as NIST SP 800-63B recommends. */
export const newPassword = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/** A password being checked: any length up to the cap, so old passwords keep working. */
export const currentPassword = z.string().min(1).max(PASSWORD_MAX_LENGTH);
export const contentDeletion = z.strictObject({ confirm: z.literal('delete') });

export const otpCode = z
	.string()
	.trim()
	.regex(/^\d{6}$/);

export const recoveryCodeInput = z.string().trim().min(1).max(32);

/** Converts form data to a plain object for schema parsing. Repeated fields are rejected. */
export function formObject(data: FormData): Record<string, string> | null {
	const result: Record<string, string> = {};
	for (const [key, value] of data) {
		if (typeof value !== 'string' || key in result) return null;
		result[key] = value;
	}
	return result;
}

/**
 * Parses form data with a strict schema: unknown fields, files and repeated fields are rejected.
 */
export function parseForm<T extends z.ZodType>(
	schema: T,
	data: FormData
): { success: true; data: z.output<T> } | { success: false; fields: string[] } {
	const object = formObject(data);
	if (!object) return { success: false, fields: [] };
	const parsed = schema.safeParse(object);
	if (parsed.success) return { success: true, data: parsed.data };
	return {
		success: false,
		fields: [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? '')))]
	};
}
