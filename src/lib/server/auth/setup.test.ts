import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureSetupCode, removeSetupCode, setupCodePath, verifySetupCode } from './setup';

let dir: string;
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'herbarium-setup-'))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('setup code', () => {
	it('is written once, readable only by the owner, and verifies', () => {
		ensureSetupCode(dir);
		const code = readFileSync(setupCodePath(dir), 'utf8').trim();
		expect(code).toMatch(/^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
		expect(statSync(setupCodePath(dir)).mode & 0o777).toBe(0o600);

		ensureSetupCode(dir);
		expect(readFileSync(setupCodePath(dir), 'utf8').trim()).toBe(code);

		expect(verifySetupCode(dir, code.toLowerCase())).toBe(true);
		expect(verifySetupCode(dir, 'AAAA-AAAA-AAAA-AAAA-AAAA')).toBe(false);
		expect(verifySetupCode(dir, '')).toBe(false);
	});

	it('stops working once removed', () => {
		ensureSetupCode(dir);
		const code = readFileSync(setupCodePath(dir), 'utf8');
		removeSetupCode(dir);
		expect(verifySetupCode(dir, code)).toBe(false);
	});
});
