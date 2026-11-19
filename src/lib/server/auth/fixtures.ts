import type { Db } from '../db/index.ts';
import { user, type Role } from '../db/schema.ts';
import { generateId } from '../crypto/tokens.ts';
import { hashPassword } from './password.ts';

/** Test helper: inserts a user with a known password. */
export async function addUser(
	db: Db,
	username: string,
	{ role = 'member', password = 'a long test password' }: { role?: Role; password?: string } = {}
): Promise<string> {
	const id = generateId();
	db.insert(user)
		.values({
			id,
			username,
			displayName: username,
			passwordHash: await hashPassword(password),
			role
		})
		.run();
	return id;
}
