import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = 4173;

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/*.e2e.ts',
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	use: { baseURL: `http://localhost:${port}` },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: `npm run build && npm run preview -- --port ${port} --strictPort`,
		port,
		reuseExistingServer: !process.env.CI,
		// Throwaway values: a fresh random key and a temporary data dir for every run.
		env: {
			ORIGIN: `http://localhost:${port}`,
			DATA_DIR: join(tmpdir(), `herbarium-e2e-${process.pid}`),
			MASTER_KEY: randomBytes(32).toString('base64')
		}
	}
});
