import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateHumanCode, normalizeHumanCode } from '../crypto/tokens.ts';

/**
 * First-run setup code. Until the first owner exists, anyone who reaches the instance could claim
 * it, so setup requires a one-time code that only the operator can read: it is written to a file
 * on the data volume (mode 0600) and never logged. The file is deleted once setup completes.
 */
export const SETUP_CODE_FILE = 'setup-code';

export const setupCodePath = (dataDir: string) => join(dataDir, SETUP_CODE_FILE);

/** Creates the setup code file unless it already exists. */
export function ensureSetupCode(dataDir: string): void {
	const path = setupCodePath(dataDir);
	if (existsSync(path)) return;
	// 20 symbols × 5 bits = 100 bits, plenty against online guessing behind a rate limit.
	writeFileSync(path, `${generateHumanCode(20)}\n`, { mode: 0o600, flag: 'wx' });
}

export function verifySetupCode(dataDir: string, input: string): boolean {
	let stored: string;
	try {
		stored = readFileSync(setupCodePath(dataDir), 'utf8');
	} catch {
		return false;
	}
	if (normalizeHumanCode(stored).length === 0) return false;
	const digest = (value: string) => createHash('sha256').update(normalizeHumanCode(value)).digest();
	return timingSafeEqual(digest(stored), digest(input));
}

export function removeSetupCode(dataDir: string): void {
	rmSync(setupCodePath(dataDir), { force: true });
}
