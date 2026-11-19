import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = 4173;

// Throwaway values: a fresh random key and a temporary data dir for every run. They are set on
// process.env so the test workers (which re-evaluate this file) see the same data dir as the server.
process.env.E2E_DATA_DIR ??= join(tmpdir(), `herbarium-e2e-${randomBytes(6).toString('hex')}`);
process.env.E2E_MASTER_KEY ??= randomBytes(32).toString('base64');

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/*.e2e.ts',
	forbidOnly: !!process.env.CI,
	retries: 0,
	// The tests share one instance and build on each other's state (setup first, then members).
	workers: 1,
	fullyParallel: false,
	use: { baseURL: `http://localhost:${port}`, locale: 'en-US' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: `npm run build && npm run preview -- --port ${port} --strictPort`,
		port,
		// Always a fresh server, so the run starts from an empty data dir.
		reuseExistingServer: false,
		env: {
			ORIGIN: `http://localhost:${port}`,
			DATA_DIR: process.env.E2E_DATA_DIR,
			MASTER_KEY: process.env.E2E_MASTER_KEY,
			BODY_SIZE_LIMIT: '1025M',
			MAX_FILE_BYTES: '1048576',
			MAX_REQUEST_BYTES: '1052672'
		}
	}
});
