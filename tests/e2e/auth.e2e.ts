import { execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Temporal } from '@js-temporal/polyfill';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import sharp from 'sharp';
import { addUser } from '../../src/lib/server/auth/fixtures.ts';
import { deriveKeys } from '../../src/lib/server/crypto/keys.ts';
import { DATABASE_FILE, openDatabase } from '../../src/lib/server/db/index.ts';
import { auditLog, event, mediaFile, memory } from '../../src/lib/server/db/schema.ts';
import { emptyEventForm } from '../../src/lib/server/events/schemas.ts';

/**
 * The security core end to end, against a production build with a fresh encrypted data dir.
 * The tests run in order and share state: setup creates the owner, later tests build on it.
 */
test.describe.configure({ mode: 'serial' });

const dataDir = process.env.E2E_DATA_DIR as string;
const ORIGIN = 'http://localhost:4173';
const owner = { username: 'alice', name: 'Alice', password: 'alice has a long password' };
const member = { username: 'bob', name: 'Bob', password: 'bob has a long password too' };
const id = 'a'.repeat(22);
const run = promisify(execFile);
const PROTECTED = [
	'/',
	'/members',
	'/account',
	'/account/export',
	'/account/export/download',
	'/calendar',
	'/events',
	'/plans',
	'/events/new',
	'/events/' + 'a'.repeat(22),
	'/events/' + 'a'.repeat(22) + '/edit',
	'/timeline',
	'/map',
	'/map/places/new',
	'/map/places/' + id,
	'/map/assets/basemap.pmtiles',
	'/map/assets/glyphs/Noto%20Sans%20Regular/0-255.pbf',
	'/map/assets/markers.png',
	'/map/assets/protomaps-light.png',
	'/memories',
	'/memories/new',
	'/memories/new/upload',
	'/memories/import',
	`/memories/import/${id}`,
	`/memories/import/${id}/upload`,
	`/memories/${id}`,
	`/memories/albums/${id}`,
	`/media/${id}/original`
];

let recoveryCodes: string[] = [];

async function login(page: Page, username: string, password: string) {
	await page.goto('/login');
	await page.getByLabel('Username').fill(username);
	await page.getByLabel('Password', { exact: true }).fill(password);
	// Wait for the form post to finish, so a following navigation cannot abort it.
	await Promise.all([
		page.waitForResponse((response) => response.request().method() === 'POST'),
		page.getByRole('button', { name: 'Sign in' }).click()
	]);
	await page.waitForLoadState();
}

/** Signs the owner in once 2FA is on, spending one recovery code. */
async function loginOwnerWithRecovery(page: Page) {
	await login(page, owner.username, owner.password);
	await page.getByLabel('Recovery code').fill(recoveryCodes.pop() as string);
	await page.getByRole('button', { name: 'Use the recovery code' }).click();
	await expect(page).toHaveURL('/');
}

async function newPage(browser: Browser, options: { javaScriptEnabled?: boolean } = {}) {
	const context = await browser.newContext(options);
	return context.newPage();
}

test('answers the health check', async ({ request }) => {
	const response = await request.get('/healthz');
	expect(response.status()).toBe(200);
	expect(await response.text()).toBe('ok');
});

test('sends every page to setup until an owner exists', async ({ page }) => {
	for (const path of [...PROTECTED, '/login']) {
		await page.goto(path);
		await expect(page).toHaveURL('/setup');
	}
});

test('first-run setup needs the setup code and creates the owner', async ({ page }) => {
	await page.goto('/setup');
	await expect(page.getByText('Keep the master key safe')).toBeVisible();

	const fill = async (code: string) => {
		await page.getByLabel('Setup code').fill(code);
		await page.getByLabel('Username').fill(owner.username);
		await page.getByLabel('Your name').fill(owner.name);
		await page.getByLabel('Password', { exact: true }).fill(owner.password);
		await page.getByLabel('Repeat the password').fill(owner.password);
		await page.getByLabel('I have stored a copy of the master key').check();
		await page.getByRole('button', { name: 'Create the owner account' }).click();
	};

	await fill('AAAA-BBBB-CCCC-DDDD-EEEE');
	await expect(page.getByText('The setup code is not correct.')).toBeVisible();

	await fill(readFileSync(join(dataDir, 'setup-code'), 'utf8').trim());
	await expect(page).toHaveURL('/');
	await expect(page.getByText(`Welcome, ${owner.name}.`)).toBeVisible();
	await expect(page.getByText('No events in the next 30 days.')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Recent memories' })).toBeVisible();

	// The code is gone and setup cannot run again.
	expect(() => readFileSync(join(dataDir, 'setup-code'))).toThrow();
	const again = await page.goto('/setup');
	expect(again?.status()).toBe(404);
});

test('the database file is encrypted', () => {
	const bytes = readFileSync(join(dataDir, 'herbarium.db'));
	expect(bytes.subarray(0, 16).toString('latin1')).not.toContain('SQLite format');
	expect(bytes.includes(owner.username)).toBe(false);
});

test('rejects anonymous access to every route', async ({ browser }) => {
	const page = await newPage(browser);
	for (const path of [...PROTECTED, '/login/verify', '/no-such-page']) {
		await page.goto(path);
		await expect(page).toHaveURL(/\/login(\?|$)/);
	}

	for (const path of [
		'/members?/invite',
		'/account?/changePassword',
		'/account?/reminders',
		'/logout',
		'/events/new',
		'/map/search',
		'/map/places/new?/save',
		'/map/places/' + id + '?/remove',
		'/events/' + 'a'.repeat(22) + '?/complete',
		'/events/' + 'a'.repeat(22) + '?/reminders',
		'/events/' + 'a'.repeat(22) + '?/delete',
		'/events/' + 'a'.repeat(22) + '/edit',
		'/memories/new',
		'/memories/new/upload',
		'/memories/import',
		`/memories/import/${id}`,
		`/memories/import/${id}/upload`,
		'/memories?/createAlbum',
		`/memories/${id}?/description`,
		`/memories/${id}?/album`,
		`/memories/${id}?/event`,
		`/memories/${id}?/coordinates`,
		`/memories/${id}?/delete`,
		`/memories/albums/${id}?/rename`,
		`/memories/albums/${id}?/delete`
	]) {
		const response = await page.request.post(path, {
			headers: { origin: ORIGIN },
			form: { x: '1' },
			maxRedirects: 0
		});
		expect(response.status(), path).toBe(401);
	}
	const data = await page.request.get('/members/__data.json');
	expect(await data.text()).not.toContain(owner.username);
});

test('rejects cross-site form posts', async ({ page }) => {
	await login(page, owner.username, owner.password);
	const response = await page.request.post('/members?/invite', {
		headers: { origin: 'https://evil.example' },
		form: { label: 'x' }
	});
	expect(response.status()).toBe(403);
});

test('sends security headers and a strict CSP', async ({ request }) => {
	const response = await request.get('/login');
	const headers = response.headers();
	const csp = headers['content-security-policy'] ?? '';
	expect(csp).toContain("default-src 'self'");
	expect(csp).toContain("frame-ancestors 'none'");
	expect(csp).toContain("object-src 'none'");
	expect(csp).not.toContain('unsafe-inline');
	expect(csp).not.toContain('unsafe-eval');
	expect(headers['referrer-policy']).toBe('same-origin');
	expect(headers['cross-origin-opener-policy']).toBe('same-origin');
	expect(headers['x-content-type-options']).toBe('nosniff');
	expect(headers['permissions-policy']).toContain('camera=()');
	expect(headers['cache-control']).toBe('no-store');
});

test('keeps the small request limit on sign-in forms', async ({ request }) => {
	const response = await request.post('/login', {
		headers: { origin: ORIGIN },
		form: { username: 'synthetic', password: 'x'.repeat(513 * 1024) }
	});
	expect(response.status()).toBe(413);
});

test('can be installed and caches only immutable client assets', async ({ page, context }) => {
	await login(page, owner.username, owner.password);
	const manifestPath = await page.locator('link[rel="manifest"]').getAttribute('href');
	const manifestResponse = await page.request.get(manifestPath!);
	expect(manifestResponse.ok()).toBe(true);
	const manifest = await manifestResponse.json();
	expect(manifest).toMatchObject({ start_url: '/', scope: '/', display: 'standalone' });
	for (const icon of manifest.icons) {
		const response = await page.request.get(icon.src);
		const { width, height } = await sharp(await response.body()).metadata();
		expect(`${width}x${height}`).toBe(icon.sizes);
	}

	await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
	await page.reload();
	await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

	const devtools = await context.newCDPSession(page);
	const { installabilityErrors } = await devtools.send('Page.getInstallabilityErrors');
	expect(installabilityErrors).toEqual([]);

	await page.goto('/members');
	await expect(page.getByText(owner.name, { exact: true })).toBeVisible();
	const cached = await page.evaluate(async () => {
		for (const path of ['/members/__data.json', '/map/assets/markers.png', '/app.webmanifest']) {
			const response = await fetch(path);
			await response.arrayBuffer();
		}
		const names = await caches.keys();
		const entries = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()));
		return entries.flat().map((request) => new URL(request.url).pathname);
	});
	expect(cached.length).toBeGreaterThan(0);
	expect(cached.every((path) => path.startsWith('/_app/immutable/'))).toBe(true);

	await context.setOffline(true);
	await expect(page.goto('/members')).rejects.toThrow('net::ERR_INTERNET_DISCONNECTED');
});

test('login works without JavaScript and fails generically', async ({ browser }) => {
	const page = await newPage(browser, { javaScriptEnabled: false });
	await login(page, owner.username, 'wrong password');
	await expect(page.getByText('The username or password is not correct.')).toBeVisible();
	await login(page, 'nobody', 'wrong password');
	await expect(page.getByText('The username or password is not correct.')).toBeVisible();

	await login(page, owner.username, owner.password);
	await expect(page).toHaveURL('/');

	const cookies = await page.context().cookies();
	const session = cookies.find((cookie) => cookie.name.includes('session'));
	expect(session?.httpOnly).toBe(true);
	expect(session?.sameSite).toBe('Lax');
	expect(session?.path).toBe('/');
});

test('an owner invites a member, and the invite works once', async ({ browser }) => {
	const ownerPage = await newPage(browser);
	await login(ownerPage, owner.username, owner.password);
	await ownerPage.setViewportSize({ width: 375, height: 812 });
	await ownerPage.goto('/members');
	await ownerPage.getByLabel('Who is this for? (optional)').fill('Bob');
	const create = ownerPage.getByRole('button', { name: 'Create an invite link' });
	await create.focus();
	await create.press('Enter');
	const link = ownerPage.getByLabel('Invite link');
	const inviteLink = await link.inputValue();
	expect(inviteLink).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
	expect((await link.boundingBox())!.y).toBeGreaterThan((await create.boundingBox())!.y);
	await expect(ownerPage.getByText(/expires/i).first()).toBeVisible();
	await ownerPage.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	await ownerPage.getByRole('button', { name: 'Copy link' }).click();
	await expect(ownerPage.getByText('Link copied.')).toBeVisible();
	expect(await ownerPage.evaluate(() => navigator.clipboard.readText())).toBe(inviteLink);
	for (const colorScheme of ['light', 'dark'] as const) {
		await ownerPage.emulateMedia({ colorScheme });
		expect(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
	}

	const page = await newPage(browser);
	await page.goto(inviteLink);
	await page.getByLabel('Username').fill(member.username);
	await page.getByLabel('Your name').fill(member.name);
	await page.getByLabel('Password', { exact: true }).fill(member.password);
	await page.getByLabel('Repeat the password').fill(member.password);
	await page.getByRole('button', { name: 'Create my account' }).click();
	await expect(page.getByText(`Welcome, ${member.name}.`)).toBeVisible();

	const other = await newPage(browser);
	await other.goto(inviteLink);
	await expect(other.getByRole('heading', { name: 'This invite cannot be used' })).toBeVisible();
});

test('members create, edit, filter, complete and delete shared events without JavaScript', async ({
	browser
}) => {
	const page = await newPage(browser, { javaScriptEnabled: false });
	await login(page, member.username, member.password);
	await page.goto('/events');
	await expect(page.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
	await page.getByRole('link', { name: 'New event' }).click();
	await page.getByLabel('Title', { exact: true }).fill('Synthetic spring journey');
	await page.getByLabel('Start', { exact: true }).fill('2023-02-29');
	await page
		.getByLabel('Notes', { exact: true })
		.fill(
			'**Pressed memory**\n<script>window.injected=true</script>\n[link](https://example.com)\n![pixel](https://example.com/pixel)'
		);
	await page.getByRole('button', { name: 'Save event', exact: true }).click();
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Synthetic spring journey');
	await page.getByLabel('Start', { exact: true }).fill('2020-03');
	await page.getByLabel('Date type').selectOption('month');
	await page.getByRole('button', { name: 'Save event', exact: true }).click();
	const detail = page.url();
	await expect(
		page.getByRole('heading', { name: 'Synthetic spring journey', exact: true })
	).toBeVisible();
	await expect(page.getByText('March 2020', { exact: true })).toBeVisible();
	await expect(page.locator('.notes strong')).toHaveText('Pressed memory');
	await expect(page.locator('.notes script, .notes img')).toHaveCount(0);
	await expect(page.locator('.notes a').first()).toHaveAttribute('rel', 'noopener noreferrer');
	await expect(page.getByText('Added by Bob')).toBeVisible();
	const other = await newPage(browser, { javaScriptEnabled: false });
	await login(other, owner.username, owner.password);
	await other.goto(detail);
	await other.getByRole('link', { name: 'Edit event', exact: true }).click();
	await other.getByLabel('Event kind').selectOption('plan');
	await other.getByLabel('Title', { exact: true }).fill('Synthetic shared journey');
	await other.getByLabel('Category').selectOption('trip');
	await other.getByLabel('Place', { exact: true }).fill('Synthetic meadow');
	await other.getByRole('button', { name: 'Save changes' }).click();
	await expect(other.getByText('Added by Bob')).toBeVisible();
	await page.goto('/events?year=2020');
	await expect(page.getByRole('link', { name: 'Synthetic shared journey' })).toHaveCount(0);
	await page.getByRole('banner').getByRole('link', { name: 'Plans', exact: true }).click();
	await page.getByRole('link', { name: 'Ready to record' }).click();
	await page.getByRole('link', { name: 'Synthetic shared journey', exact: true }).click();
	await page.getByRole('button', { name: 'Mark as moment' }).click();
	await expect(page).toHaveURL(detail);
	await expect(page.getByText('Moment · Trip', { exact: true })).toBeVisible();
	await expect(page.getByRole('banner').getByRole('link', { name: 'Events' })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await page.getByRole('link', { name: 'Back to events' }).click();
	await page.getByRole('link', { name: 'Synthetic shared journey', exact: true }).click();

	await page
		.locator('summary')
		.filter({ hasText: /^Delete event$/ })
		.click();
	await page.getByLabel('Current password').fill('wrong synthetic password');
	await page.getByRole('button', { name: 'Delete event', exact: true }).click();
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page.getByLabel('Current password')).toHaveValue('');
	await page.getByLabel('Current password').fill(member.password);
	await page.getByRole('button', { name: 'Delete event', exact: true }).click();
	await expect(page).toHaveURL('/events');
	const missing = await page.goto(detail);
	expect(missing?.status()).toBe(404);
});

test('members can save, schedule and clear the same plan without JavaScript', async ({
	browser
}) => {
	const page = await newPage(browser, { javaScriptEnabled: false });
	await login(page, member.username, member.password);
	await page.getByRole('banner').getByRole('link', { name: 'Plans', exact: true }).click();
	await page.getByRole('link', { name: 'New plan' }).click();
	await page.getByLabel('Title', { exact: true }).fill('Synthetic weekend idea');
	await page.getByRole('button', { name: 'Save plan', exact: true }).click();
	await expect(page.getByText('No date yet', { exact: true })).toBeVisible();
	const plan = page.url();
	await expect(page.getByRole('button', { name: 'Mark as moment' })).toHaveCount(0);
	await page.getByRole('link', { name: 'Add place', exact: true }).click();
	await page.getByLabel('Place', { exact: true }).fill('Synthetic riverside');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page).toHaveURL(plan);
	await expect(page.getByText('Synthetic riverside')).toBeVisible();

	await page.goto('/');
	await page.getByRole('link', { name: 'Plans without a date' }).click();
	await page.getByRole('link', { name: 'Synthetic weekend idea' }).click();
	await page.getByRole('link', { name: 'Set date', exact: true }).click();
	await page.getByLabel('Date type').selectOption('date');
	await page.getByLabel('Start', { exact: true }).fill('2033-06-18');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page).toHaveURL(plan);
	await expect(page.getByText('June 18, 2033')).toBeVisible();
	await page.getByRole('link', { name: 'Back to plans' }).click();
	await expect(page).toHaveURL('/plans');
	await expect(page.getByRole('link', { name: 'Synthetic weekend idea' })).toBeVisible();
	await page.getByRole('link', { name: 'Without a date' }).click();
	await expect(page.getByRole('link', { name: 'Synthetic weekend idea' })).toHaveCount(0);
	for (const query of ['view=unknown', 'view=ideas&view=scheduled', 'page=0'])
		expect((await page.request.get('/plans?' + query)).status()).toBe(400);
	const calendar = '/calendar?view=day&date=2033-06-18';
	await page.goto(calendar);
	await page.getByRole('link', { name: 'Synthetic weekend idea' }).click();
	await page.getByRole('link', { name: 'Change date' }).click();
	await page.getByLabel('Date type').selectOption('undated');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page).toHaveURL(plan);
	await expect(page.getByText('No date yet', { exact: true })).toBeVisible();
	await page.goto(calendar);
	await expect(page.getByRole('link', { name: 'Synthetic weekend idea' })).toHaveCount(0);
	await page.context().close();
});

test('mixed upload retries preserve successful files and link to the intended destination', async ({
	browser
}, testInfo) => {
	mkdirSync(testInfo.outputDir, { recursive: true });
	const gpsPhoto = testInfo.outputPath('synthetic-batch-gps.jpg');
	const photo = await sharp(randomBytes(640 * 640 * 3), {
		raw: { width: 640, height: 640, channels: 3 }
	})
		.jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
		.toBuffer();
	// Media above the ordinary form limit still fits within the configured upload limit.
	expect(photo.length).toBeGreaterThan(512 * 1024);
	expect(photo.length).toBeLessThan(1024 * 1024);
	writeFileSync(gpsPhoto, photo);
	await run('exiftool', [
		'-overwrite_original',
		'-GPSLatitude=12.34',
		'-GPSLatitudeRef=N',
		'-GPSLongitude=56.78',
		'-GPSLongitudeRef=E',
		gpsPhoto
	]);
	const video = testInfo.outputPath('synthetic-batch-video.mp4');
	await run('ffmpeg', [
		'-v',
		'error',
		'-f',
		'lavfi',
		'-i',
		'color=c=blue:s=64x48:r=10',
		'-t',
		'0.5',
		'-c:v',
		'libx264',
		'-threads',
		'1',
		video
	]);

	const page = await newPage(browser);
	await page.setViewportSize({ width: 375, height: 812 });
	await login(page, member.username, member.password);
	await page.goto('/events/new?kind=plan');
	await page.getByLabel('Title', { exact: true }).fill('Synthetic upload plan');
	await page.getByRole('button', { name: 'Save plan', exact: true }).click();
	await expect(page).toHaveURL(/\/events\/[\w-]{22}$/);
	const eventUrl = page.url();
	await page.getByRole('link', { name: 'Add photos and videos' }).click();
	await expect(page.getByText('Adding to Synthetic upload plan')).toBeVisible();
	let uploadCount = 0;
	const gpsResponse = page.waitForResponse(
		(response) =>
			response.url().includes('/memories/new/upload?event=') && response.status() === 201
	);
	await page.route('**/memories/new/upload?event=*', async (route) => {
		uploadCount += 1;
		if (uploadCount !== 3) {
			await route.continue();
			return;
		}
		const response = await route.fetch();
		expect(response.status()).toBe(201);
		await route.abort('failed');
	});
	const queue = page.getByRole('region', { name: 'Add photos and videos' });
	await queue.getByLabel('Choose files').setInputFiles([gpsPhoto, video]);
	await queue.getByLabel('Choose files').setInputFiles([
		{ name: 'retry-photo.jpg', mimeType: 'image/jpeg', buffer: photo },
		{ name: 'invalid.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not an image') }
	]);
	await queue.getByRole('button', { name: 'Upload', exact: true }).click();
	const retry = queue.getByRole('listitem').filter({ hasText: 'retry-photo.jpg' });
	await expect(retry).toContainText('Upload interrupted.');
	await expect(queue.getByRole('listitem').filter({ hasText: 'invalid.jpg' })).toContainText(
		'This file could not be opened as a supported photo or video.'
	);
	await retry.getByRole('button', { name: 'Retry' }).click();
	await expect(retry).toContainText('Uploaded');
	await expect(queue.getByText('3 of 4 uploaded')).toBeVisible();
	for (const colorScheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
	}
	const gps = (await (await gpsResponse).json()) as { id: string; suggestion: { token: string } };
	expect(gps.suggestion.token).toBeTruthy();
	await page.getByRole('link', { name: 'Return to Synthetic upload plan' }).click();
	await expect(page).toHaveURL(eventUrl);
	const eventMemories = page.getByRole('region', { name: 'Memories' });
	await expect(eventMemories.getByRole('link', { name: 'Photo', exact: true })).toHaveCount(2);
	await expect(eventMemories.getByRole('link', { name: /invalid.jpg/ })).toHaveCount(0);
	await eventMemories.getByRole('link', { name: 'Video', exact: true }).click();
	await expect(page.locator('video')).toBeVisible();

	await page.goto('/memories');
	await page.getByRole('link', { name: 'Albums', exact: true }).click();
	await page.getByLabel('Album name').fill('Synthetic mixed album');
	await page.getByRole('button', { name: 'Create album' }).click();
	await expect(page).toHaveURL(/\/memories\/albums\/[\w-]{22}$/);
	await page.getByRole('link', { name: 'Add photos and videos' }).click();
	await expect(page.getByText('Adding to Synthetic mixed album')).toBeVisible();
	await queue.getByLabel('Choose files').setInputFiles([gpsPhoto, video]);
	await queue.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(queue.getByText('2 of 2 uploaded')).toBeVisible();
	await page.getByRole('link', { name: 'Return to Synthetic mixed album' }).click();
	await expect(page.getByRole('link', { name: 'Video', exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Photo', exact: true })).toBeVisible();

	await page.goto('/memories/new');
	await queue.getByLabel('Choose files').setInputFiles({
		name: 'standalone-swatch.jpg',
		mimeType: 'image/jpeg',
		buffer: photo
	});
	await queue.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(queue.getByText('1 of 1 uploaded')).toBeVisible();
	await page.getByRole('link', { name: 'Return to Memories' }).click();
	const unlinked = page.getByRole('region', { name: 'Memories without an event' });
	const linked = page.getByRole('region', { name: 'Synthetic upload plan' });
	await expect(unlinked.getByRole('link', { name: /^Photo$/ })).toHaveCount(2);
	await expect(unlinked.getByRole('link', { name: /^Video$/ })).toHaveCount(1);
	await expect(linked.getByRole('link', { name: 'Synthetic upload plan' })).toHaveAttribute(
		'href',
		new URL(eventUrl).pathname
	);
	await expect(linked.getByRole('link', { name: /^Photo$/ })).toHaveCount(2);
	const clip = linked.getByRole('link', { name: /^Video$/ });
	await expect(clip.locator('.play')).toBeVisible();
	await expect(clip).toHaveText('');
	await clip.click();
	await expect(page.getByRole('dialog', { name: 'Memories' }).locator('video')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(clip).toBeFocused();
	await expect(page.getByText(/standalone-swatch\.jpg|synthetic-batch-video\.mp4/)).toHaveCount(0);
	await page.goto(`/memories?event=${new URL(eventUrl).pathname.split('/').pop()}`);
	await expect(page.getByRole('link', { name: /^Video$/ })).toBeVisible();
	await expect(page.getByText('synthetic-batch-video.mp4', { exact: true })).toHaveCount(0);

	await page.goto('/events/new?kind=plan');
	await page.getByLabel('Title', { exact: true }).fill('Synthetic destination plan');
	await page.getByRole('button', { name: 'Save plan', exact: true }).click();
	await expect(page).toHaveURL(/\/events\/[\w-]{22}$/);
	const destination = page.url();
	const gpsMemory = '/memories/' + gps.id;
	await page.goto(gpsMemory);
	await page
		.locator('summary')
		.filter({ hasText: /^Change event link$/ })
		.click();
	await page.getByLabel('Find an event by title').fill('Synthetic destination');
	await page.getByRole('button', { name: 'Filter', exact: true }).click();
	await page
		.getByRole('combobox', { name: 'Linked event' })
		.selectOption({ label: 'Synthetic destination plan' });
	await page.getByRole('button', { name: 'Save linked event' }).click();
	await expect(page.getByRole('link', { name: 'Synthetic destination plan' })).toBeVisible();
	const stale = await page.request.post(gpsMemory + '?/coordinates', {
		headers: { origin: ORIGIN },
		form: { token: gps.suggestion.token }
	});
	expect(stale.status()).toBe(400);
	await page.goto(destination);
	await expect(page.getByRole('link', { name: 'Photo', exact: true })).toBeVisible();
	await expect(page.getByText(/Latitude: 12.34/)).toHaveCount(0);
	await page.goto(gpsMemory);
	await page
		.locator('summary')
		.filter({ hasText: /^Change event link$/ })
		.click();
	await page.getByRole('combobox', { name: 'Linked event' }).selectOption('');
	await page.getByRole('button', { name: 'Save linked event' }).click();
	await expect(page.getByRole('link', { name: 'Synthetic destination plan' })).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'synthetic-batch-gps.jpg' })).toBeVisible();
	await page.goto('/memories');
	await expect(unlinked.locator(`a[href="${gpsMemory}"]`)).toBeVisible();
	await expect(linked.locator(`a[href="${gpsMemory}"]`)).toHaveCount(0);
	await page.context().close();
});

test('members create and edit recurring occasions without JavaScript', async ({ browser }) => {
	const page = await newPage(browser, { javaScriptEnabled: false });
	await login(page, member.username, member.password);
	await page.goto('/events/new');
	await page.getByLabel('Event kind').selectOption('occasion');
	await page.getByLabel('Title', { exact: true }).fill('Synthetic leap-day celebration');
	await page.getByLabel('Start', { exact: true }).fill('2000-02-29');
	await page.getByText('For occasions', { exact: true }).click();
	await page.getByLabel('Occasion type').selectOption('anniversary');
	await page.getByRole('button', { name: 'Save event', exact: true }).click();
	await expect(page.getByText('Recurrence: yearly', { exact: true })).toBeVisible();
	await expect(
		page
			.getByRole('listitem')
			.filter({ hasText: /anniversary$/i })
			.first()
	).toBeVisible();

	await page.getByRole('link', { name: 'Edit event', exact: true }).click();
	await expect(page.getByLabel('Occasion type')).toHaveValue('anniversary');
	await page.getByLabel('Occasion type').selectOption('general');
	await page.getByLabel('Unit', { exact: true }).selectOption('WEEKLY');
	await page.getByLabel('Repeat every').fill('2');
	await page.getByRole('button', { name: 'Save changes', exact: true }).click();
	await expect(page.getByText('Recurrence: Every 2 weeks', { exact: true })).toBeVisible();

	await page.goto('/events?kind=occasion');
	await expect(page.getByRole('link', { name: 'Synthetic leap-day celebration' })).toBeVisible();
	await page.context().close();
});

test('calendar expands occasions and creates events from a date on a phone without JavaScript', async ({
	browser
}) => {
	const page = await newPage(browser, { javaScriptEnabled: false });
	await page.setViewportSize({ width: 360, height: 800 });
	await login(page, member.username, member.password);
	await page.goto('/events/new');
	await page.getByLabel('Event kind').selectOption('occasion');
	await page.getByLabel('Title', { exact: true }).fill('Synthetic calendar anniversary');
	await page.getByLabel('Start', { exact: true }).fill('2000-02-29');
	await page.getByText('For occasions', { exact: true }).click();
	await page.getByLabel('Occasion type').selectOption('anniversary');
	await page.getByRole('button', { name: 'Save event', exact: true }).click();

	await page.goto('/calendar?date=2100-02-01');
	const leapFallback = page.getByRole('region', { name: 'February 28, 2100' });
	await expect(
		leapFallback.getByRole('link', { name: 'Synthetic calendar anniversary' })
	).toContainText('100th anniversary');
	const firstDay = await page.getByRole('region', { name: 'February 1, 2100' }).boundingBox();
	const secondDay = await page.getByRole('region', { name: 'February 2, 2100' }).boundingBox();
	expect(secondDay!.y - (firstDay!.y + firstDay!.height)).toBeLessThanOrEqual(2);
	expect(await page.locator('body').evaluate((body) => body.scrollWidth)).toBeLessThanOrEqual(360);
	await leapFallback.getByRole('link', { name: 'Add an event on February 28, 2100' }).click();
	await expect(page.getByLabel('Start', { exact: true })).toHaveValue('2100-02-28');
	await expect(page.getByLabel('Event kind')).toHaveValue('plan');
	await page.getByLabel('Title', { exact: true }).fill('Synthetic calendar plan');
	await page.getByRole('button', { name: 'Save event', exact: true }).click();

	await page.goto('/calendar');
	await page.getByRole('link', { name: 'Week', exact: true }).click();
	await page.getByLabel('Jump to date', { exact: true }).fill('2100-02-28');
	await page.getByRole('button', { name: 'Go', exact: true }).click();
	await expect(page).toHaveURL('/calendar?view=week&date=2100-02-28');
	await expect(page.getByRole('link', { name: 'Synthetic calendar plan' })).toBeVisible();
	await page.getByRole('link', { name: 'Day', exact: true }).click();
	await expect(page.getByRole('link', { name: 'Synthetic calendar anniversary' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Synthetic calendar plan' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Today', exact: true })).toBeVisible();
	await page.getByRole('link', { name: 'Next', exact: true }).click();
	await expect(page).toHaveURL('/calendar?view=day&date=2100-03-01');
	await expect(page.getByText('No events on this date.')).toBeVisible();

	for (const query of [
		'date=2100-02-29',
		'date=2026-11-18&date=2026-11-19',
		'view=year',
		'other=1'
	]) {
		expect((await page.request.get('/calendar?' + query)).status()).toBe(400);
	}
	expect((await page.request.get('/events/new?date=2100-02-29')).status()).toBe(400);
	await page.context().close();
});

test('members set their own email preferences and shared event reminders without JavaScript', async ({
	browser
}) => {
	const page = await newPage(browser, { javaScriptEnabled: false });
	await login(page, member.username, member.password);
	await page.goto('/account');
	const preferences = page.getByRole('region', { name: 'Calendar and email preferences' });
	await expect(preferences.getByText('The owner has not configured email delivery.')).toBeVisible();
	await preferences.getByLabel('Time zone').fill('America/New_York');
	await preferences.getByLabel('Reminder email address').fill('synthetic.member@example.test');
	await preferences.getByLabel('Send me email reminders').check();
	await preferences.getByRole('button', { name: 'Save preferences' }).click();
	await expect(page).toHaveURL('/account#reminder-preferences');
	await expect(preferences.getByLabel('Send me email reminders')).toBeChecked();
	await expect(preferences.getByLabel('Time zone')).toHaveValue('America/New_York');

	await page.goto('/calendar?view=day&date=2100-02-28');
	await page.getByRole('link', { name: 'Add an event on February 28, 2100' }).click();
	await expect(page.getByLabel('Time zone', { exact: true })).toHaveValue('America/New_York');
	await page.goto('/calendar?view=day&date=2100-02-28');
	await page.getByRole('link', { name: 'Synthetic calendar plan' }).click();
	const eventUrl = new URL(page.url()).pathname;
	const reminder = page.getByRole('region', { name: 'Reminders', exact: true });
	await reminder.locator('summary').click();
	await reminder.getByLabel('15 minutes before').check();
	await reminder.getByLabel('1 day before').check();
	await reminder.getByRole('button', { name: 'Save reminder times' }).click();
	await expect(page).toHaveURL(eventUrl + '#event-reminders');

	const other = await newPage(browser, { javaScriptEnabled: false });
	await login(other, owner.username, owner.password);
	await other.goto(eventUrl);
	await expect(other.getByLabel('15 minutes before')).toBeChecked();
	await expect(other.getByLabel('1 day before')).toBeChecked();
	await other.goto('/account');
	await expect(other.getByLabel('Reminder email address')).toHaveValue('');
	await expect(other.getByLabel('Send me email reminders')).not.toBeChecked();
	const invalid = await page.request.post(eventUrl + '?/reminders', {
		form: { unknownOffset: 'on' },
		headers: { origin: ORIGIN }
	});
	expect(invalid.status()).toBe(400);
	await other.context().close();
	await page.context().close();
});

test('timed events retain their local year and future plans cannot be completed early', async ({
	browser
}) => {
	const page = await newPage(browser, { javaScriptEnabled: false });
	await login(page, member.username, member.password);
	await page.goto('/events/new');
	await page.getByLabel('Title', { exact: true }).fill('Synthetic midnight');
	await page.getByLabel('Event kind').selectOption('plan');
	await page.getByLabel('Date type').selectOption('timed');
	await page.getByLabel('Start', { exact: true }).fill('9999-01-01T00:30');
	await page.getByLabel('Time zone', { exact: true }).fill('Asia/Kathmandu');
	await page.getByRole('button', { name: 'Save event', exact: true }).click();
	const detail = page.url();
	await expect(page.getByText(/January 1, 9999/)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Mark as moment' })).toHaveCount(0);
	const blocked = await page.request.post(detail + '?/complete', {
		form: {},
		headers: { origin: ORIGIN }
	});
	expect(blocked.status()).toBe(400);
	await page.getByRole('link', { name: 'Edit plan', exact: true }).click();
	await expect(page.getByLabel('Start', { exact: true })).toHaveValue('9999-01-01T00:30');
	await page.getByLabel('Event kind').selectOption('moment');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByRole('alert')).toContainText('after it finishes');
	await page.getByLabel('Event kind').selectOption('plan');
	await page.getByLabel('Start', { exact: true }).fill('2024-01-01T00:30');
	await page.getByRole('button', { name: 'Save changes' }).click();
	await page.goto('/events?kind=plan&year=2024');
	await expect(page.getByRole('link', { name: 'Synthetic midnight' })).toBeVisible();
	await page.goto('/events?kind=plan&year=2023');
	await expect(page.getByRole('link', { name: 'Synthetic midnight' })).toHaveCount(0);
	for (const query of ['year=bad', 'year=2024&year=2023', 'other=1', '__proto__=1']) {
		const response = await page.request.get('/events?' + query);
		expect(response.status()).toBe(400);
	}
	const malformed = await page.request.get('/events/bad-id');
	expect(malformed.status()).toBe(404);
	await page.goto(detail);
	await page
		.locator('summary')
		.filter({ hasText: /^Delete event$/ })
		.click();
	await page.getByLabel('Current password').fill(member.password);
	await page.getByRole('button', { name: 'Delete event', exact: true }).click();
	await expect(page).toHaveURL('/events');
});

test('main workflows render in three languages and both themes on a phone', async ({ browser }) => {
	for (const [locale, heading, save, timeline, upcoming] of [
		['en', 'New event', 'Save event', 'Timeline', 'Coming up'],
		['be', 'Новая падзея', 'Захаваць падзею', 'Храналогія', 'Бліжэйшыя падзеі'],
		['ru', 'Новое событие', 'Сохранить событие', 'Хронология', 'Ближайшие события']
	]) {
		const context = await browser.newContext({ locale, viewport: { width: 375, height: 812 } });
		const page = await context.newPage();
		// Login labels are locale-dependent; request the form with the same credentials instead.
		await page.goto('/login');
		await page.locator('input[name="username"]').fill(member.username);
		await page.locator('input[name="password"]').fill(member.password);
		await page.locator('main form button').click();
		await expect(page).toHaveURL('/');
		await expect(page.getByRole('heading', { name: upcoming, exact: true })).toBeVisible();
		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme });
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
				true
			);
		}
		await page.goto('/events/new');
		await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
		await page.locator('input[name="title"]').fill(`Synthetic ${locale} event`);
		await page.locator('select[name="when"]').selectOption('year');
		await page.locator('input[name="start"]').fill('2020');
		await page.locator('textarea[name="notes"]').fill('A **synthetic** memory.');
		await page.getByRole('button', { name: save, exact: true }).click();
		await expect(
			page.getByRole('heading', { name: `Synthetic ${locale} event`, exact: true })
		).toBeVisible();
		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme });
			await page.screenshot({
				path: `/tmp/herbarium-event-${locale}-${colorScheme}.png`,
				fullPage: true
			});
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
				true
			);
		}
		await page.getByRole('link', { name: timeline, exact: true }).click();
		await expect(page.getByRole('heading', { name: timeline, exact: true })).toBeVisible();
		for (const colorScheme of ['light', 'dark'] as const) {
			await page.emulateMedia({ colorScheme });
			expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
				true
			);
		}
		await page.setViewportSize({ width: 320, height: 812 });
		for (const path of ['/events', '/plans', '/memories', '/memories?view=albums']) {
			await page.goto(path);
			await expect(page.locator('main h1')).toBeVisible();
			for (const colorScheme of ['light', 'dark'] as const) {
				await page.emulateMedia({ colorScheme });
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
					true
				);
			}
		}
		await context.close();
	}
});

test('timeline groups dates and pages through filtered events without JavaScript', async ({
	browser
}) => {
	const page = await newPage(browser, { javaScriptEnabled: false });
	await page.setViewportSize({ width: 360, height: 800 });
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await login(page, member.username, member.password);
	await expect(page).toHaveURL('/');
	for (let year = 1975; year <= 1999; year++) {
		const response = await page.request.post('/events/new', {
			headers: { origin: ORIGIN, accept: 'text/html' },
			form: {
				...emptyEventForm,
				title: `Synthetic milestone ${year}`,
				category: 'milestone',
				precision: 'month',
				start: `${year}-03`
			},
			maxRedirects: 0
		});
		expect(response.status()).toBe(303);
	}

	await page.getByRole('navigation').getByRole('link', { name: 'Timeline', exact: true }).click();
	const anniversary = page.getByRole('region', { name: '2000' });
	await expect(
		anniversary.getByRole('link', { name: 'Synthetic calendar anniversary' })
	).toBeVisible();
	await expect(page.getByRole('link', { name: 'Synthetic calendar anniversary' })).toHaveCount(1);
	await page.getByLabel('Event kind').selectOption('moment');
	await page.getByLabel('Category').selectOption('milestone');
	await page.getByRole('button', { name: 'Filter' }).click();
	await expect(page.getByRole('heading', { level: 2 }).first()).toHaveText('1999');
	await expect(page.getByRole('heading', { level: 2 }).last()).toHaveText('1976');
	await expect(page.getByRole('region', { name: '1999' }).getByText('March 1999')).toBeVisible();
	await expect(page.locator('.marker').first()).toHaveCSS('animation-name', 'none');
	const stem = page.locator('.timeline');
	expect(
		await stem.evaluate((element) => getComputedStyle(element, '::before').animationName)
	).toBe('none');

	await page.getByRole('link', { name: 'Older events' }).click();
	await expect(page.getByRole('heading', { level: 2 })).toHaveText('1975');
	await expect(page.getByLabel('Event kind')).toHaveValue('moment');
	await expect(page.getByLabel('Category')).toHaveValue('milestone');
	await page.getByRole('link', { name: 'Newer events' }).click();
	await page.getByRole('link', { name: 'Synthetic milestone 1999' }).click();
	await expect(page).toHaveURL(/\/events\/[\w-]{22}$/);
	for (const query of ['category=unknown', 'kind=plan&kind=moment', 'older=bad', 'other=1']) {
		expect((await page.request.get('/timeline?' + query)).status()).toBe(400);
	}
	await page.context().close();
});

test('uploads private memories, browses them by keyboard and manages independent albums', async ({
	browser
}, testInfo) => {
	mkdirSync(testInfo.outputDir, { recursive: true });
	const photo = testInfo.outputPath('synthetic-photo.jpg');
	const video = testInfo.outputPath('synthetic-video.mp4');
	await sharp({ create: { width: 64, height: 48, channels: 3, background: '#b87468' } })
		.jpeg()
		.toFile(photo);
	await run('exiftool', [
		'-overwrite_original',
		'-GPSLatitude=12.34',
		'-GPSLatitudeRef=N',
		'-GPSLongitude=56.78',
		'-GPSLongitudeRef=E',
		'-DateTimeOriginal=2020:02:03 12:34:56',
		photo
	]);
	await run('ffmpeg', [
		'-v',
		'error',
		'-f',
		'lavfi',
		'-i',
		'color=c=blue:s=64x48:r=10',
		'-t',
		'0.5',
		'-c:v',
		'libx264',
		'-threads',
		'1',
		'-metadata',
		'creation_time=2021-02-03T12:34:56Z',
		video
	]);

	const offline = await newPage(browser, { javaScriptEnabled: false });
	await login(offline, member.username, member.password);
	await offline.goto('/events/new');
	await offline.getByLabel('Title', { exact: true }).fill('Synthetic collection');
	await offline.getByLabel('Start', { exact: true }).fill('2020-02-03');
	await offline.getByRole('button', { name: 'Save event', exact: true }).click();
	await expect(offline).toHaveURL(/\/events\/[\w-]{22}$/);
	const eventUrl = offline.url();
	await offline.getByRole('link', { name: 'Add photos and videos' }).click();
	await offline.getByLabel('Photo or video').setInputFiles(photo);
	await offline.getByLabel('Alt text').fill('A rose-coloured swatch');
	await offline.getByLabel('Caption').fill('Winter swatch');
	await offline.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(offline.getByRole('heading', { name: 'Use the photo’s location?' })).toBeVisible();
	const eventBefore = await offline.request.get(eventUrl);
	expect(await eventBefore.text()).not.toContain('Latitude: 12.34');
	await offline.getByRole('button', { name: 'Use coordinates' }).click();
	await expect(offline).toHaveURL(eventUrl);
	await expect(offline.getByText('Latitude: 12.34, Longitude: 56.78')).toBeVisible();
	await offline.getByRole('link', { name: /Winter swatch/ }).click();
	await expect(offline.getByRole('img', { name: 'A rose-coloured swatch' })).toBeVisible();
	const photoUrl = offline.url();
	await offline.goto('/');
	const recent = offline.getByRole('region', { name: 'Recent memories' });
	await expect(recent.getByRole('img', { name: 'A rose-coloured swatch' })).toBeVisible();
	await recent.getByRole('link', { name: /Winter swatch/ }).click();
	await expect(offline).toHaveURL(photoUrl);
	await offline.goto('/timeline');
	const timelinePhoto = offline.getByRole('img', { name: 'A rose-coloured swatch' });
	await expect(timelinePhoto).toHaveAttribute('loading', 'lazy');
	const thumbnail = await offline.request.get((await timelinePhoto.getAttribute('src'))!);
	expect(thumbnail.status()).toBe(200);
	expect(thumbnail.headers()['content-type']).toBe('image/jpeg');
	await offline.getByRole('link', { name: 'A rose-coloured swatch' }).click();
	await expect(offline).toHaveURL(photoUrl);
	const downloadUrl = await offline
		.getByRole('link', { name: 'Download original' })
		.getAttribute('href');
	const download = await offline.request.get(downloadUrl!);
	expect(download.headers()['content-disposition']).toContain('attachment');
	expect(download.headers()['content-type']).toBe('image/jpeg');
	expect((await download.body()).equals(readFileSync(photo))).toBe(false);

	await offline.goto('/memories');
	await offline.getByRole('link', { name: 'Albums', exact: true }).click();
	await offline.getByLabel('Album name').fill('Synthetic album');
	await offline.getByRole('button', { name: 'Create album' }).click();
	await expect(offline.getByRole('heading', { name: 'Synthetic album' })).toBeVisible();
	const albumUrl = offline.url();
	await offline.goto(photoUrl);
	await offline.getByLabel('Album name').selectOption({ label: 'Synthetic album' });
	await offline.getByRole('button', { name: 'Add to album' }).click();
	await offline.getByRole('link', { name: 'Synthetic album' }).click();
	await expect(offline).toHaveURL(albumUrl);
	await expect(offline.getByRole('link', { name: /Winter swatch/ })).toBeVisible();
	await offline.getByRole('link', { name: 'Back to albums' }).click();
	await expect(
		offline.getByRole('link', { name: 'Synthetic album' }).locator('img')
	).toHaveAttribute('src', /\/media\/[^/]+\/thumbnail$/);

	await offline.goto('/memories/new');
	const rejected = await offline.request.post('/memories/new', {
		headers: { origin: ORIGIN },
		multipart: {
			altText: '',
			caption: '',
			file: { name: 'oversized.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(1048577) }
		}
	});
	expect(rejected.status()).toBe(413);
	await offline.goto(eventUrl);
	await offline.getByRole('link', { name: 'Add photos and videos' }).click();
	await offline.getByLabel('Photo or video').setInputFiles(video);
	await offline.getByLabel('Caption').fill('Spring clip');
	await offline.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(offline.getByRole('heading', { name: 'synthetic-video.mp4' })).toBeVisible();
	const preview = (await offline.locator('video').getAttribute('src'))!;
	const ranged = await offline.request.get(preview, { headers: { range: 'bytes=0-7' } });
	expect(ranged.status()).toBe(206);
	expect(ranged.headers()['content-range']).toMatch(/^bytes 0-7\/\d+$/);
	expect(ranged.headers()['content-type']).toBe('video/mp4');
	expect(ranged.headers()['cache-control']).toContain('no-store');
	expect((await ranged.body()).length).toBe(8);

	const other = await newPage(browser);
	await login(other, owner.username, owner.password);
	await other.goto('/memories');
	const collection = other.getByRole('region', { name: 'Synthetic collection' });
	await expect(
		collection.locator('li a').filter({ hasText: /Spring clip|Winter swatch/ })
	).toHaveText([/Spring clip/, /Winter swatch/]);
	const clip = collection.getByRole('link', { name: /Spring clip/ });
	await clip.focus();
	await other.keyboard.press('Enter');
	await expect(other.getByRole('dialog', { name: 'Spring clip' })).toBeVisible();
	await other.keyboard.press('ArrowRight');
	await expect(other.getByRole('dialog', { name: 'Winter swatch' })).toBeVisible();
	await other.keyboard.press('Escape');
	await expect(other.getByRole('dialog')).toHaveCount(0);
	await expect(clip).toBeFocused();

	await offline.goto(eventUrl);
	await offline
		.locator('summary')
		.filter({ hasText: /^Delete event$/ })
		.click();
	await offline.getByLabel('Current password').fill(member.password);
	await offline.getByRole('button', { name: 'Delete event', exact: true }).click();
	await expect(offline).toHaveURL('/events');
	await offline.goto(albumUrl);
	await expect(offline.getByRole('link', { name: /Winter swatch/ })).toBeVisible();
	await offline
		.locator('summary')
		.filter({ hasText: /^Delete album$/ })
		.click();
	await offline.getByLabel('Current password').fill(member.password);
	await offline.getByRole('button', { name: 'Delete album', exact: true }).click();
	await expect(offline).toHaveURL('/memories?view=albums');
	await offline.getByRole('link', { name: 'Gallery', exact: true }).click();
	await expect(
		offline
			.getByRole('region', { name: 'Memories without an event' })
			.getByRole('link', { name: /Winter swatch/ })
	).toBeVisible();
	await offline.goto(photoUrl);
	await offline
		.locator('summary')
		.filter({ hasText: /^Delete memory$/ })
		.click();
	await offline.getByLabel('Current password').fill(member.password);
	await offline.getByRole('button', { name: 'Delete memory', exact: true }).click();
	await expect(offline).toHaveURL('/memories');
	expect((await offline.request.get(downloadUrl!)).status()).toBe(404);
});

test('resumes bulk imports and confirms dated groups with a photo location', async ({
	browser
}, info) => {
	mkdirSync(info.outputDir, { recursive: true });
	const first = info.outputPath('first-photo.jpg');
	const second = info.outputPath('second-photo.jpg');
	const undated = info.outputPath('undated.jpg');
	await sharp({ create: { width: 31, height: 23, channels: 3, background: '#408068' } })
		.jpeg()
		.toFile(first);
	copyFileSync(first, second);
	for (const [file, lat] of [
		[first, '18.12'],
		[second, '19.12']
	] as const) {
		await run('exiftool', [
			'-overwrite_original',
			`-GPSLatitude=${lat}`,
			'-GPSLatitudeRef=N',
			'-GPSLongitude=28.56',
			'-GPSLongitudeRef=E',
			'-DateTimeOriginal=2022:09:17 12:00:00',
			file
		]);
	}
	await sharp({ create: { width: 32, height: 24, channels: 3, background: '#807040' } })
		.jpeg()
		.toFile(undated);

	const page = await newPage(browser);
	await login(page, member.username, member.password);
	await page.goto('/memories');
	await page.getByRole('link', { name: 'Bulk import' }).click();
	await page.getByRole('button', { name: 'Start import' }).click();
	await expect(page).toHaveURL(/\/memories\/import\/[\w-]{22}$/);
	const importUrl = page.url();
	const uploadUrl = `${importUrl}/upload`;
	const outsider = await newPage(browser);
	await login(outsider, owner.username, owner.password);
	expect((await outsider.request.get(importUrl)).status()).toBe(404);
	expect(
		(
			await outsider.request.get(uploadUrl, { headers: { 'X-Herbarium-Upload': '0'.repeat(64) } })
		).status()
	).toBe(404);
	await outsider.context().close();
	expect(
		(
			await page.request.post(uploadUrl, {
				headers: { Origin: 'https://foreign.example', 'X-Herbarium-Upload': '0'.repeat(64) },
				multipart: { altText: '', caption: '' }
			})
		).status()
	).toBe(403);

	let posts = 0;
	const stopped = Promise.withResolvers<void>();
	const unblock = Promise.withResolvers<void>();
	await page.route(uploadUrl, async (route) => {
		if (route.request().method() === 'POST' && ++posts === 2) {
			stopped.resolve();
			await unblock.promise;
			await route.abort().catch(() => undefined);
			return;
		}
		await route.continue();
	});
	await expect(page.getByLabel('Choose files')).toBeEnabled();
	await page.getByLabel('Choose files').setInputFiles([first, second, undated]);
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await stopped.promise;
	await page.getByRole('button', { name: 'Pause', exact: true }).click();
	unblock.resolve();
	await expect(page.getByText('Upload paused.')).toBeVisible();
	await expect(page.getByRole('link', { name: 'first-photo.jpg' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'second-photo.jpg' })).toHaveCount(0);

	await page.reload();
	await expect(page.getByLabel('Choose files')).toBeEnabled();
	await page.getByLabel('Choose files').setInputFiles([first, second, undated]);
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.getByText('Finished processing the selected files.')).toBeVisible();
	expect(posts).toBe(4);
	const dated = page.getByRole('group', { name: /Sep 17, 2022|September 17, 2022/ });
	await expect(dated.getByRole('link')).toHaveCount(2);
	await expect(
		page
			.getByRole('group', { name: 'Unknown capture date' })
			.getByRole('checkbox', { name: 'Create a moment' })
	).toHaveCount(0);
	await dated.getByLabel('Moment or album title').fill('Imported garden');
	await dated.getByRole('checkbox', { name: 'Create a moment' }).check();
	await dated.getByRole('checkbox', { name: 'Create an album' }).check();
	await dated.getByRole('button', { name: 'Use the photo’s location?' }).click();
	await expect(dated.getByText('second-photo.jpg · 19.12, 28.56')).toBeVisible();
	await expect(dated.getByRole('checkbox', { name: 'Use coordinates' })).not.toBeChecked();
	await dated.getByRole('checkbox', { name: 'Use coordinates' }).check();
	await dated.getByRole('button', { name: 'Save group' }).click();
	await expect(page.getByRole('link', { name: 'Open moment' })).toBeVisible();
	const moment = await page.getByRole('link', { name: 'Open moment' }).getAttribute('href');
	const createdAlbum = await page.getByRole('link', { name: 'Open album' }).getAttribute('href');
	expect(await (await page.request.get(moment!)).text()).toContain(
		'Latitude: 19.12, Longitude: 28.56'
	);
	expect(await (await page.request.get(createdAlbum!)).text()).toContain('Imported garden');

	await page.getByRole('button', { name: 'Finish import' }).click();
	await page.getByRole('link', { name: 'Bulk import' }).click();
	await page.getByRole('button', { name: 'Start import' }).click();
	await expect(page.getByLabel('Choose files')).toBeEnabled();
	await page.getByLabel('Choose files').setInputFiles(first);
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.getByText('first-photo.jpg · Duplicate skipped')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Review groups' })).toHaveCount(0);
	await page.getByRole('button', { name: 'Finish import' }).click();
	await page.context().close();
});

test('loads local tiles and glyphs, searches for places and edits pins without outbound requests', async ({
	page,
	browser
}) => {
	copyFileSync('tests/fixtures/maps/belarus.pmtiles', join(dataDir, 'basemap.pmtiles'));
	await login(page, member.username, member.password);

	const outbound: string[] = [];
	const violations: string[] = [];
	await page.context().route(/^https?:/, (route) => {
		const url = new URL(route.request().url());
		if (url.origin === ORIGIN) return route.continue();
		outbound.push(url.origin);
		return route.abort();
	});
	page.on('console', (message) => {
		const text = message.text();
		// SvelteKit's route announcer includes this fixed inline style on navigation.
		if (
			text.includes('Content Security Policy') &&
			!text.includes('S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo=')
		)
			violations.push(text);
	});

	const create = async (
		title: string,
		start: string,
		lat: string,
		lon: string,
		category: string
	) => {
		const response = await page.request.post('/events/new', {
			headers: { origin: ORIGIN, accept: 'text/html' },
			form: { ...emptyEventForm, title, start, lat, lon, category },
			maxRedirects: 0
		});
		expect(response.status()).toBe(303);
		return response.headers().location!;
	};
	await create('Synthetic second pin', '1982-05-17', '53.901', '27.563', 'date');
	await create('Synthetic visit at the same point', '1982-05-17', '53.90019', '27.56653', 'trip');
	await create('Synthetic unpinned event', '1982-05-17', '', '', 'date');
	await page.goto('/events/new');
	await page.getByLabel('Title', { exact: true }).fill('Synthetic pinned visit');
	await page.getByLabel('Start', { exact: true }).fill('1982-05-17');
	await page.getByLabel('Category').selectOption('trip');
	await page.getByText('Location on the map', { exact: true }).click();
	await page.getByRole('searchbox', { name: 'Place name' }).fill('Minsk');
	await page.getByRole('button', { name: 'Find places' }).click();
	await page.getByRole('button', { name: 'Minsk Belarus', exact: true }).click();
	await expect(page.getByLabel('Place', { exact: true })).toHaveValue('Minsk');
	await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('53.90019');
	await page.getByRole('button', { name: 'Clear pin' }).click();
	await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('');
	await page.getByLabel('Paste latitude, longitude').fill('91, 27.56');
	await page.getByRole('button', { name: 'Set pin' }).click();
	await expect(page.getByText('Enter a latitude from', { exact: false })).toBeVisible();
	await page.getByLabel('Paste latitude, longitude').fill('53.90019, 27.56653');
	await page.getByRole('button', { name: 'Set pin' }).click();
	await expect(page.getByLabel('Longitude', { exact: true })).toHaveValue('27.56653');

	const pickerMap = page.locator('.maplibregl-canvas');
	await expect(pickerMap).toBeVisible();
	await pickerMap.click({ position: { x: 135, y: 120 } });
	await expect(page.getByLabel('Latitude', { exact: true })).not.toHaveValue('53.90019');
	const pin = page.locator('.maplibregl-marker');
	const bounds = (await pin.boundingBox())!;
	const pinX = bounds.x + bounds.width / 2;
	const pinY = bounds.y + bounds.height / 2;
	const beforeDrag = await page.getByLabel('Longitude', { exact: true }).inputValue();
	await page.mouse.move(pinX, pinY);
	await page.mouse.down();
	await page.mouse.move(pinX + 45, pinY - 10, { steps: 6 });
	await page.mouse.up();
	await expect(page.getByLabel('Longitude', { exact: true })).not.toHaveValue(beforeDrag);

	// Restore a stable position for the overview assertions.
	await page.getByLabel('Paste latitude, longitude').fill('53.90019, 27.56653');
	await page.getByRole('button', { name: 'Set pin' }).click();
	await page.getByRole('button', { name: 'Save event', exact: true }).click();
	await expect(page).toHaveURL(/\/events\/[\w-]{22}$/);
	const eventUrl = page.url();
	await expect(page.getByText('Latitude: 53.90019, Longitude: 27.56653')).toBeVisible();
	await expect(page.locator('.maplibregl-marker')).toBeVisible();

	await page.getByRole('link', { name: 'Add photos and videos' }).click();
	await page.getByText('Upload one file', { exact: true }).click();
	const photo = await sharp({
		create: { width: 80, height: 64, channels: 3, background: '#a38768' }
	})
		.jpeg()
		.toBuffer();
	await page
		.getByLabel('Photo or video')
		.setInputFiles({ name: 'sample.jpg', mimeType: 'image/jpeg', buffer: photo });
	await page.getByLabel('Alt text').fill('An ochre swatch');
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'sample.jpg' })).toBeVisible();

	const filters = '?kind=moment&year=1982&category=trip';
	const tile = page.waitForResponse(
		(response) => response.url().endsWith('/basemap.pmtiles') && response.status() === 206
	);
	const glyph = page.waitForResponse(
		(response) => response.url().includes('/glyphs/') && response.ok()
	);
	const sprite = page.waitForResponse(
		(response) => /markers(?:@2x)?\.png$/.test(response.url()) && response.ok()
	);
	const basemapSprite = page.waitForResponse(
		(response) => /protomaps-(?:light|dark)(?:@2x)?\.png$/.test(response.url()) && response.ok()
	);
	const document = await page.goto('/map' + filters);
	expect(document?.headers()['content-security-policy']).toMatch(/worker-src 'self'(?:;|$)/);
	expect(document?.headers()['content-security-policy']).not.toContain('unsafe-eval');
	const [range] = await Promise.all([tile, glyph, sprite, basemapSprite]);
	expect(range.headers()['content-range']).toMatch(/^bytes 0-\d+\/\d+$/);
	const overview = page.locator('.maplibregl-canvas');
	await expect(overview).toBeVisible();
	const rect = (await overview.boundingBox())!;
	await expect(async () => {
		await overview.click({ position: { x: rect.width / 2, y: rect.height / 2 - 14 } });
		await expect(
			page.locator('.maplibregl-popup').getByRole('img', { name: 'An ochre swatch' })
		).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 6500 });
	await expect(page.locator('.maplibregl-popup')).toContainText('Synthetic pinned visit');
	await expect(page.locator('.maplibregl-popup')).toContainText('May 17, 1982');
	await expect(
		page
			.locator('.maplibregl-popup')
			.getByRole('link', { name: 'Synthetic visit at the same point' })
	).toBeVisible();
	await page.getByRole('button', { name: 'Close event preview' }).click();

	const offline = await newPage(browser, { javaScriptEnabled: false });
	await login(offline, member.username, member.password);
	await offline.goto('/map?year=1982');
	await expect(offline.getByRole('link', { name: 'Synthetic second pin' })).toBeVisible();
	await expect(offline.getByRole('link', { name: 'Synthetic unpinned event' })).toHaveCount(0);
	const listLink = offline.getByRole('link', { name: 'Synthetic pinned visit' });
	await listLink.focus();
	await offline.keyboard.press('Enter');
	await expect(offline).toHaveURL(eventUrl);
	await offline.context().close();

	for (const query of ['year=0000', 'kind=moment&kind=plan', 'category=invalid', 'lat=0'])
		expect((await page.request.get('/map?' + query)).status()).toBe(400);
	expect(outbound).toEqual([]);
	expect(violations).toEqual([]);
});

test('reuses saved places for separate stops and preserves the event when a place changes', async ({
	browser
}) => {
	const page = await newPage(browser);
	await login(page, member.username, member.password);
	await page.goto('/map');
	await page.getByRole('link', { name: 'Save a new place' }).click();
	await page.locator('input[name=place]').fill('Garden gate');
	await page.locator('input[name=lat]').fill('53.91');
	await page.locator('input[name=lon]').fill('27.57');
	await page.getByRole('button', { name: 'Save place' }).click();
	const saved = await page.getByRole('link', { name: 'Garden gate' }).getAttribute('href');
	await page.goto('/events/new?kind=plan');
	await page.getByLabel('Title', { exact: true }).fill('Garden walk');
	await page.getByText('Add date, place or notes', { exact: true }).click();
	await page.getByLabel('Choose a saved place').selectOption({ label: 'Garden gate' });
	await page.getByRole('button', { name: 'Add another place' }).click();
	await page.locator('[name="extra-place"]').fill('Riverside');
	await page.locator('.stop summary').click();
	await page.locator('[name="extra-lat"]').fill('53.95');
	await page.locator('[name="extra-lon"]').fill('27.62');
	await page.getByRole('link', { name: 'Account', exact: true }).click();
	await expect(page.getByRole('dialog', { name: 'Account' })).toBeVisible();
	await expect(page).toHaveURL('/events/new?kind=plan');
	const panel = page.getByRole('dialog');
	await panel.getByRole('button', { name: 'Беларуская' }).click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'be');
	await panel.getByRole('button', { name: 'English' }).click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await page.keyboard.press('Escape');
	await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Garden walk');
	await page.getByRole('button', { name: 'Save plan' }).click();
	await expect(page.getByRole('heading', { name: 'Garden walk' })).toBeVisible();
	const eventUrl = page.url();
	await page.goto('/map');
	await expect(page.getByRole('link', { name: 'Garden walk' })).toHaveCount(2);
	await page.goto(saved!);
	await page.locator('input[name=place]').fill('New gate');
	await page.getByRole('button', { name: 'Save place' }).click();
	await page.getByRole('link', { name: 'New gate' }).click();
	await page.locator('summary').filter({ hasText: 'Delete saved place' }).click();
	await page.getByLabel('Confirm with your password').fill(member.password);
	await page.getByRole('button', { name: 'Delete saved place' }).click();
	await expect(page.getByRole('link', { name: 'New gate' })).toHaveCount(0);
	await page.goto(eventUrl);
	await expect(page.getByText('Garden gate', { exact: true })).toBeVisible();
	await expect(page.getByText('Riverside', { exact: true })).toBeVisible();
	await page.context().close();
});

test('the dashboard opens after login and shows upcoming and past dates without JavaScript', async ({
	browser
}) => {
	const page = await newPage(browser, { javaScriptEnabled: false });
	await page.setViewportSize({ width: 360, height: 800 });
	await login(page, member.username, member.password);
	await expect(page).toHaveURL('/');
	const today = Temporal.PlainDate.from(
		(await page.locator('main time').first().getAttribute('datetime'))!
	);
	for (const input of [
		{ title: 'Synthetic tomorrow', start: today.add({ days: 1 }).toString(), kind: 'plan' },
		{
			title: 'Synthetic past on this day',
			start: today.with({ year: 1996 }).toString(),
			kind: 'moment'
		}
	]) {
		const response = await page.request.post('/events/new', {
			headers: { origin: ORIGIN, accept: 'text/html' },
			form: { ...emptyEventForm, ...input },
			maxRedirects: 0
		});
		expect(response.status()).toBe(303);
	}
	const response = await page.reload();
	expect(response?.headers()['cache-control']).toBe('no-store');
	const upcoming = page.getByRole('region', { name: 'Coming up' });
	await expect(
		upcoming.getByRole('listitem').filter({ hasText: 'Synthetic tomorrow' })
	).toContainText('tomorrow');
	const anniversary = page.getByRole('region', { name: 'Next anniversary' });
	await expect(
		anniversary.getByRole('link', { name: 'Synthetic calendar anniversary' })
	).toBeVisible();
	await expect(anniversary.getByRole('heading', { name: 'Time together' })).toBeVisible();
	const history = page.getByRole('region', { name: 'On this day' });
	await expect(history.getByRole('link', { name: 'Synthetic past on this day' })).toBeVisible();
	expect(await page.locator('body').evaluate((body) => body.scrollWidth)).toBeLessThanOrEqual(360);
	await upcoming.getByRole('link', { name: 'Synthetic tomorrow' }).click();
	await expect(page.getByRole('heading', { name: 'Synthetic tomorrow' })).toBeVisible();
	await page.context().close();
});

test('exports shared data after password confirmation and restores it with the production CLI', async ({
	browser
}, info) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	await login(page, member.username, member.password);
	await page.goto('/account');
	await page.getByRole('link', { name: 'Export shared data' }).click();
	await page.locator('input[name=currentPassword]').fill('wrong export password');
	await page.getByRole('button', { name: 'Download ZIP' }).click();
	await expect(page.getByRole('alert')).toBeVisible();

	await page.locator('input[name=currentPassword]').fill(member.password);
	const downloading = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download ZIP' }).click();
	const download = await downloading;
	expect(download.suggestedFilename()).toBe('herbarium-export.zip');
	const archive = info.outputPath('herbarium-export.zip');
	await download.saveAs(archive);
	await context.close();

	const destination = info.outputPath('destination');
	mkdirSync(destination);
	const master = randomBytes(32);
	const key = deriveKeys(master).database;
	const path = join(destination, DATABASE_FILE);
	const fresh = openDatabase({ path, key });
	const ownerId = await addUser(fresh.db, 'destination-owner', { role: 'owner' });
	fresh.close();
	await run(process.execPath, ['build/operations/restore.js', archive], {
		env: { ...process.env, ORIGIN, DATA_DIR: destination, MASTER_KEY: master.toString('base64') }
	});
	const restored = openDatabase({ path, key });
	try {
		expect(restored.db.select().from(auditLog).all()).toMatchObject([
			{ event: 'archive_restored', actorId: ownerId }
		]);
		expect(
			restored.db
				.select()
				.from(event)
				.all()
				.some((row) => row.lat !== null)
		).toBe(true);
		expect(restored.db.select().from(memory).all().length).toBeGreaterThan(0);
		expect(
			restored.db
				.select()
				.from(mediaFile)
				.all()
				.some((row) => row.variant === 'thumbnail')
		).toBe(true);
	} finally {
		restored.close();
	}
});

test('a revoked invite cannot be used', async ({ browser }) => {
	const ownerPage = await newPage(browser);
	await login(ownerPage, owner.username, owner.password);
	await ownerPage.goto('/members');
	await ownerPage.getByRole('button', { name: 'Create an invite link' }).click();
	const inviteLink = await ownerPage.getByLabel('Invite link').inputValue();
	await ownerPage.getByRole('button', { name: 'Revoke' }).click();
	await expect(ownerPage.getByText('Revoked.')).toBeVisible();

	const page = await newPage(browser);
	await page.goto(inviteLink);
	await expect(page.getByRole('heading', { name: 'This invite cannot be used' })).toBeVisible();
});

test('members see each other but cannot manage members', async ({ browser }) => {
	const page = await newPage(browser);
	await login(page, member.username, member.password);
	await page.goto('/members');
	await expect(page.getByText(owner.name)).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Invites' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Deactivate' })).toHaveCount(0);

	const response = await page.request.post('/members?/invite', {
		headers: { origin: ORIGIN, accept: 'application/json' },
		form: { label: 'x' }
	});
	expect(await response.text()).toContain('403');
});

test('the last owner cannot step down', async ({ page }) => {
	await login(page, owner.username, owner.password);
	await page.goto('/members');
	await page
		.getByRole('group', { name: `Actions for ${owner.name}` })
		.getByRole('button', { name: 'Make member' })
		.click();
	await expect(page.getByText('At least one active owner must remain.')).toBeVisible();
});

test('deactivating a member locks them out immediately', async ({ browser }) => {
	const memberPage = await newPage(browser);
	await login(memberPage, member.username, member.password);
	await expect(memberPage).toHaveURL('/');

	const ownerPage = await newPage(browser);
	await login(ownerPage, owner.username, owner.password);
	await ownerPage.goto('/members');
	await ownerPage
		.getByRole('group', { name: `Actions for ${member.name}` })
		.getByRole('button', { name: 'Deactivate' })
		.click();
	await expect(ownerPage.getByText('Deactivated')).toBeVisible();

	await memberPage.goto('/members');
	await expect(memberPage).toHaveURL(/\/login/);
	await login(memberPage, member.username, member.password);
	await expect(memberPage.getByText('The username or password is not correct.')).toBeVisible();
});

test('repeated failed logins are rate-limited', async ({ page }) => {
	for (let i = 0; i < 6; i++) await login(page, 'mallory', `guess ${i}`);
	await login(page, 'mallory', 'guess again');
	await expect(page.getByText(/Too many attempts/)).toBeVisible();
});

test('two-step verification with TOTP and recovery codes', async ({ browser }) => {
	const page = await newPage(browser);
	await login(page, owner.username, owner.password);
	await page.goto('/account');
	const section = page.getByRole('region', { name: 'Two-step verification' });
	await section.getByLabel('Confirm with your password').fill(owner.password);
	await section.getByRole('button', { name: 'Set up' }).click();
	await expect(page.getByRole('img', { name: 'QR code for the authenticator app' })).toBeVisible();

	const secret = (await section.locator('code').first().innerText()).replaceAll(' ', '');
	const totp = new TOTP({ secret: Secret.fromBase32(secret) });
	await page.getByLabel('Code', { exact: true }).fill(totp.generate());
	await page.getByRole('button', { name: 'Turn on' }).click();
	await expect(page.getByText('Two-step verification is now on.')).toBeVisible();
	recoveryCodes = await page.locator('.codes code').allInnerTexts();
	expect(recoveryCodes).toHaveLength(10);

	// A fresh login now asks for the second factor; nothing else is reachable meanwhile.
	const next = await newPage(browser);
	await login(next, owner.username, owner.password);
	await expect(next).toHaveURL(/\/login\/verify/);
	await next.goto('/members');
	await expect(next).toHaveURL(/\/login\/verify/);

	await next.getByLabel('Code', { exact: true }).fill('000000');
	await next.getByRole('button', { name: 'Verify' }).click();
	await expect(next.getByText('The code is not correct.')).toBeVisible();

	const used = recoveryCodes.pop() as string;
	await next.getByLabel('Recovery code').fill(used);
	await next.getByRole('button', { name: 'Use the recovery code' }).click();
	await expect(next).toHaveURL('/');

	// The same recovery code does not work twice.
	const third = await newPage(browser);
	await login(third, owner.username, owner.password);
	await third.getByLabel('Recovery code').fill(used);
	await third.getByRole('button', { name: 'Use the recovery code' }).click();
	await expect(third.getByText('already used')).toBeVisible();
});

test('changing the password signs out all other devices', async ({ browser }) => {
	const first = await newPage(browser);
	await loginOwnerWithRecovery(first);
	const second = await newPage(browser);
	await loginOwnerWithRecovery(second);

	await first.goto('/account');
	const section = first.getByRole('region', { name: 'Password' });
	await section.getByLabel('Current password').fill(owner.password);
	owner.password = 'alice now has a new password';
	await section.getByLabel('New password').fill(owner.password);
	await section.getByLabel('Repeat the password').fill(owner.password);
	await section.getByRole('button', { name: 'Change the password' }).click();
	await expect(first.getByText('The password was changed.')).toBeVisible();

	await first.goto('/members');
	await expect(first).toHaveURL('/members');
	await second.goto('/members');
	await expect(second).toHaveURL(/\/login/);
});

test('signing out ends the session on the server', async ({ browser }) => {
	const page = await newPage(browser);
	await loginOwnerWithRecovery(page);
	const cookies = await page.context().cookies();

	await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
	await page.getByRole('link', { name: 'Account', exact: true }).click();
	await page.getByRole('button', { name: 'Sign out', exact: true }).click();
	await expect(page).toHaveURL('/login');

	// The old cookie is dead on the server, not just removed from the browser.
	const replay = await browser.newContext();
	await replay.addCookies(cookies);
	const again = await replay.newPage();
	await again.goto('/members');
	await expect(again).toHaveURL(/\/login/);
});

test('saves language per member without JavaScript and uses it on another device', async ({
	browser
}) => {
	const page = await newPage(browser, { javaScriptEnabled: false });
	await loginOwnerWithRecovery(page);
	const response = await page.request.post('/account?/language', {
		form: { locale: 'de' },
		headers: { origin: ORIGIN }
	});
	expect(response.status()).toBe(400);
	await expect(page.getByLabel('Language', { exact: true })).toHaveCount(0);
	await expect(page.getByLabel('Appearance', { exact: true })).toHaveCount(0);
	await page.getByRole('link', { name: 'Account', exact: true }).click();
	await page.getByRole('button', { name: 'Беларуская' }).click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'be');
	await expect(page.getByRole('heading', { name: 'Акаўнт', exact: true })).toBeVisible();

	const other = await newPage(browser);
	await loginOwnerWithRecovery(other);
	await expect(other.locator('html')).toHaveAttribute('lang', 'be');
	await other.goto('/members');
	await expect(other.locator('html')).toHaveAttribute('lang', 'be');

	await page.getByRole('button', { name: 'Русский' }).click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
	await page.getByRole('button', { name: 'English' }).click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await other.reload();
	await expect(other.locator('html')).toHaveAttribute('lang', 'en');
});

test('appearance follows the system, persists overrides and works on a narrow screen', async ({
	browser
}) => {
	const context = await browser.newContext({
		colorScheme: 'dark',
		locale: 'en-US',
		viewport: { width: 320, height: 812 }
	});
	const page = await context.newPage();
	const fontResponse = page.waitForResponse((response) =>
		new URL(response.url()).pathname.endsWith('.woff2')
	);
	await page.goto('/login');
	const font = await fontResponse;
	expect(font.ok()).toBe(true);
	expect(new URL(font.url()).pathname).toMatch(/^\/_app\/immutable\//);
	const background = () =>
		page.locator('body').evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
	expect(await background()).toBe('rgb(20, 31, 36)');
	await page.getByLabel('Appearance', { exact: true }).selectOption('light');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
	expect(await background()).toBe('rgb(238, 232, 218)');
	await page.reload();
	await expect(page.getByLabel('Appearance', { exact: true })).toHaveValue('light');
	await page.getByLabel('Appearance', { exact: true }).selectOption('dark');
	await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
	expect(await background()).toBe('rgb(20, 31, 36)');
	await page.getByLabel('Appearance', { exact: true }).selectOption('system');
	expect(await background()).toBe('rgb(238, 232, 218)');
	await page.reload();
	await page.keyboard.press('Tab');
	await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(page.locator('main')).toBeFocused();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await loginOwnerWithRecovery(page);
	await expect(page.getByLabel('Appearance', { exact: true })).toHaveCount(0);
	await page.getByRole('link', { name: 'Account', exact: true }).click();
	await page.getByLabel('Appearance', { exact: true }).selectOption('dark');
	await page.keyboard.press('Escape');
	await expect(page.getByRole('link', { name: 'Account', exact: true })).toBeFocused();
	await page.getByRole('link', { name: 'Home', exact: true }).click();
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await context.close();
});

test('public authentication screens render all locales with both themes', async ({ browser }) => {
	for (const locale of ['en', 'be', 'ru']) {
		for (const colorScheme of ['light', 'dark'] as const) {
			const context = await browser.newContext({ locale, colorScheme, javaScriptEnabled: false });
			const page = await context.newPage();
			await page.goto('/login');
			await expect(page.locator('html')).toHaveAttribute('lang', locale);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			await expect(page.locator('input[name="username"]')).toBeVisible();
			await expect(page.locator('input[name="password"]')).toBeVisible();
			await page.screenshot({
				path: `/tmp/herbarium-login-${locale}-${colorScheme}.png`,
				fullPage: true
			});
			expect(
				await page
					.locator('body')
					.evaluate(() => getComputedStyle(document.documentElement).colorScheme)
			).toBe(colorScheme);
			await context.close();
		}
	}
});
