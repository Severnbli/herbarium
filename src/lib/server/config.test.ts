import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, type Env } from './config';

const keyBase64 = randomBytes(32).toString('base64');
const keyHex = randomBytes(32).toString('hex');

const prodEnv: Env = {
	ORIGIN: 'https://herbarium.example.org',
	DATA_DIR: '/data',
	MASTER_KEY: keyBase64
};

function issuesOf(fn: () => unknown): string[] {
	try {
		fn();
	} catch (error) {
		if (error instanceof ConfigError) return error.issues;
		throw error;
	}
	throw new Error('expected a ConfigError');
}

describe('loadConfig', () => {
	it('accepts a complete production configuration', () => {
		const config = loadConfig(prodEnv, { production: true });
		expect(config.origin.href).toBe('https://herbarium.example.org/');
		expect(config.dataDir).toBe('/data');
		expect(config.masterKey).toEqual(Buffer.from(keyBase64, 'base64'));
		expect(config.limits.maxFileBytes).toBe(1024 ** 3);
		expect(config.production).toBe(true);
	});

	it('uses development defaults for origin and data dir', () => {
		const config = loadConfig({ MASTER_KEY: keyHex }, { production: false, cwd: '/srv/app' });
		expect(config.origin.href).toBe('http://localhost:5173/');
		expect(config.dataDir).toBe('/srv/app/data');
		expect(config.masterKey).toEqual(Buffer.from(keyHex, 'hex'));
	});

	describe('origin', () => {
		it('is required in production', () => {
			expect(issuesOf(() => loadConfig({ ...prodEnv, ORIGIN: '' }, { production: true }))).toEqual([
				expect.stringContaining('ORIGIN is required')
			]);
		});

		it('refuses plain http in production', () => {
			const env = { ...prodEnv, ORIGIN: 'http://herbarium.example.org' };
			expect(issuesOf(() => loadConfig(env, { production: true }))).toEqual([
				expect.stringContaining('https://')
			]);
		});

		it.each(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000'])(
			'allows plain http on loopback in production: %s',
			(origin) => {
				expect(loadConfig({ ...prodEnv, ORIGIN: origin }, { production: true }).origin.origin).toBe(
					origin
				);
			}
		);

		it.each([
			'https://example.org/app',
			'https://example.org/?x=1',
			'not a url',
			'ftp://example.org'
		])('rejects %s', (origin) => {
			expect(
				issuesOf(() => loadConfig({ ...prodEnv, ORIGIN: origin }, { production: true }))
			).toHaveLength(1);
		});

		it('accepts a trailing slash', () => {
			const env = { ...prodEnv, ORIGIN: 'https://example.org/' };
			expect(loadConfig(env, { production: true }).origin.origin).toBe('https://example.org');
		});
	});

	describe('master key', () => {
		it('is required in every mode', () => {
			for (const production of [true, false]) {
				expect(
					issuesOf(() => loadConfig({ ...prodEnv, MASTER_KEY: undefined }, { production }))
				).toEqual([expect.stringContaining('master key is required')]);
			}
		});

		it('is read from MASTER_KEY_FILE', () => {
			const env = { ...prodEnv, MASTER_KEY: undefined, MASTER_KEY_FILE: '/run/secrets/key' };
			const config = loadConfig(env, {
				production: true,
				readFile: (path) => (path === '/run/secrets/key' ? `${keyHex}\n` : '')
			});
			expect(config.masterKey).toEqual(Buffer.from(keyHex, 'hex'));
		});

		it('reports an unreadable key file', () => {
			const env = { ...prodEnv, MASTER_KEY: undefined, MASTER_KEY_FILE: '/missing' };
			const issues = issuesOf(() =>
				loadConfig(env, {
					production: true,
					readFile: () => {
						throw new Error('ENOENT');
					}
				})
			);
			expect(issues).toEqual([expect.stringContaining('could not be read')]);
		});

		it('rejects setting both sources', () => {
			const env = { ...prodEnv, MASTER_KEY_FILE: '/run/secrets/key' };
			expect(issuesOf(() => loadConfig(env, { production: true }))).toEqual([
				expect.stringContaining('not both')
			]);
		});

		it.each([
			['too short', randomBytes(16).toString('base64')],
			['too long', randomBytes(48).toString('hex')],
			['a passphrase', 'correct horse battery staple']
		])('rejects a key that is %s', (_label, key) => {
			expect(
				issuesOf(() => loadConfig({ ...prodEnv, MASTER_KEY: key }, { production: true }))
			).toEqual([expect.stringContaining('exactly 32 bytes')]);
		});

		it('never puts the key into error messages', () => {
			const badKey = 'secret-value-that-must-not-leak';
			const env = { ...prodEnv, ORIGIN: 'http://example.org', MASTER_KEY: badKey };
			const issues = issuesOf(() => loadConfig(env, { production: true }));
			expect(issues.join('\n')).not.toContain(badKey);
		});
	});

	describe('limits', () => {
		it('parses byte limits', () => {
			const env = { ...prodEnv, MAX_FILE_BYTES: '1000', MAX_REQUEST_BYTES: '5000' };
			expect(loadConfig(env, { production: true }).limits).toEqual({
				maxFileBytes: 1000,
				maxRequestBytes: 5000
			});
		});

		it('rejects invalid numbers', () => {
			const env = { ...prodEnv, MAX_FILE_BYTES: '-1' };
			expect(issuesOf(() => loadConfig(env, { production: true }))).toEqual([
				expect.stringContaining('MAX_FILE_BYTES')
			]);
		});

		it('requires the file limit to fit in the request limit', () => {
			const env = { ...prodEnv, MAX_FILE_BYTES: '5000', MAX_REQUEST_BYTES: '1000' };
			expect(issuesOf(() => loadConfig(env, { production: true }))).toEqual([
				expect.stringContaining('must not exceed')
			]);
		});
	});

	it('requires DATA_DIR in production', () => {
		expect(
			issuesOf(() => loadConfig({ ...prodEnv, DATA_DIR: undefined }, { production: true }))
		).toEqual([expect.stringContaining('DATA_DIR')]);
	});

	it('reports all problems at once', () => {
		const issues = issuesOf(() => loadConfig({}, { production: true }));
		expect(issues).toHaveLength(3);
	});
});
