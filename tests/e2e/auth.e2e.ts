import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import sharp from 'sharp';

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
	'/calendar',
	'/events',
	'/events/new',
	'/events/' + 'a'.repeat(22),
	'/events/' + 'a'.repeat(22) + '/edit',
	'/memories',
	'/memories/new',
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
		'/events/' + 'a'.repeat(22) + '?/complete',
		'/events/' + 'a'.repeat(22) + '?/reminders',
		'/events/' + 'a'.repeat(22) + '?/delete',
		'/events/' + 'a'.repeat(22) + '/edit',
		'/memories/new',
		'/memories?/createAlbum',
		`/memories/${id}?/description`,
		`/memories/${id}?/album`,
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
	await ownerPage.goto('/members');
	await ownerPage.getByLabel('Who is it for?').fill('Bob');
	await ownerPage.getByRole('button', { name: 'Create an invite link' }).click();
	const inviteLink = await ownerPage.getByLabel('Invite link').inputValue();
	expect(inviteLink).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);

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
	await page.getByLabel('Date precision').selectOption('month');
	await page.getByLabel('Event kind').selectOption('plan');
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
	await other.getByRole('link', { name: 'Edit', exact: true }).click();
	await other.getByLabel('Title', { exact: true }).fill('Synthetic shared journey');
	await other.getByLabel('Category').selectOption('trip');
	await other.getByLabel('Place', { exact: true }).fill('Synthetic meadow');
	await other.getByRole('button', { name: 'Save changes' }).click();
	await expect(other.getByText('Added by Bob')).toBeVisible();
	await page.goto('/events');
	await page.getByLabel('Event kind').selectOption('plan');
	await page.getByLabel('Start year').fill('2020');
	await page.getByRole('button', { name: 'Filter', exact: true }).click();
	await page.getByRole('link', { name: 'Synthetic shared journey', exact: true }).click();
	await page.getByRole('button', { name: 'Mark as moment' }).click();
	await expect(page).toHaveURL(detail);
	await expect(page.getByText('Moment · Trip', { exact: true })).toBeVisible();
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

	await page.getByRole('link', { name: 'Edit', exact: true }).click();
	await expect(page.getByLabel('Occasion type')).toHaveValue('anniversary');
	await page.getByLabel('Occasion type').selectOption('general');
	await page.getByLabel('Repeat', { exact: true }).selectOption('custom');
	await page.getByLabel('Custom frequency').selectOption('WEEKLY');
	await page.getByLabel('Custom interval').fill('2');
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
	await page.getByRole('button', { name: 'Save event', exact: true }).click();

	await page.goto('/calendar?date=2100-02-01');
	const leapFallback = page.getByRole('region', { name: 'February 28, 2100' });
	await expect(
		leapFallback.getByRole('link', { name: 'Synthetic calendar anniversary' })
	).toBeVisible();
	expect(await page.locator('body').evaluate((body) => body.scrollWidth)).toBeLessThanOrEqual(360);
	await leapFallback.getByRole('link', { name: 'Add an event on February 28, 2100' }).click();
	await expect(page.getByLabel('Start', { exact: true })).toHaveValue('2100-02-28');
	await expect(page.getByLabel('Event kind')).toHaveValue('plan');
	await page.getByLabel('Title', { exact: true }).fill('Synthetic calendar plan');
	await page.getByRole('button', { name: 'Save event', exact: true }).click();

	await page.goto('/calendar');
	await page.getByRole('link', { name: 'Week', exact: true }).click();
	await page.getByLabel('Jump to date').fill('2100-02-28');
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
	await expect(page.getByRole('button', { name: 'Mark as moment' })).toBeDisabled();
	const blocked = await page.request.post(detail + '?/complete', {
		form: {},
		headers: { origin: ORIGIN }
	});
	expect(blocked.status()).toBe(400);
	await page.getByRole('link', { name: 'Edit', exact: true }).click();
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
	await page.getByLabel('Current password').fill(member.password);
	await page.getByRole('button', { name: 'Delete event', exact: true }).click();
	await expect(page).toHaveURL('/events');
});

test('event screens render in three languages and both themes on a phone', async ({ browser }) => {
	for (const [locale, heading, save] of [
		['en', 'New event', 'Save event'],
		['be', 'Новая падзея', 'Захаваць падзею'],
		['ru', 'Новое событие', 'Сохранить событие']
	]) {
		const context = await browser.newContext({ locale, viewport: { width: 375, height: 812 } });
		const page = await context.newPage();
		// Login labels are locale-dependent; request the form with the same credentials instead.
		await page.goto('/login');
		await page.locator('input[name="username"]').fill(member.username);
		await page.locator('input[name="password"]').fill(member.password);
		await page.locator('main form button').click();
		await expect(page).toHaveURL('/');
		await page.goto('/events/new');
		await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
		await page.locator('input[name="title"]').fill(`Synthetic ${locale} event`);
		await page.locator('input[name="start"]').fill('2020');
		await page.locator('select[name="precision"]').selectOption('year');
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
		await context.close();
	}
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
	await offline.getByRole('link', { name: 'Add a memory' }).click();
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
	const downloadUrl = await offline
		.getByRole('link', { name: 'Download original' })
		.getAttribute('href');
	const download = await offline.request.get(downloadUrl!);
	expect(download.headers()['content-disposition']).toContain('attachment');
	expect(download.headers()['content-type']).toBe('image/jpeg');
	expect((await download.body()).equals(readFileSync(photo))).toBe(false);

	await offline.goto('/memories');
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
	await expect(other.locator('li a').filter({ hasText: /Spring clip|Winter swatch/ })).toHaveText([
		/Spring clip/,
		/Winter swatch/
	]);
	const clip = other.getByRole('link', { name: /Spring clip/ });
	await clip.focus();
	await other.keyboard.press('Enter');
	await expect(other.getByRole('dialog', { name: 'Spring clip' })).toBeVisible();
	await other.keyboard.press('ArrowRight');
	await expect(other.getByRole('dialog', { name: 'Winter swatch' })).toBeVisible();
	await other.keyboard.press('Escape');
	await expect(other.getByRole('dialog')).toHaveCount(0);
	await expect(clip).toBeFocused();

	await offline.goto(eventUrl);
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
	await expect(offline).toHaveURL('/memories');
	await expect(offline.getByRole('link', { name: /Winter swatch/ })).toBeVisible();
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

	await page.getByRole('button', { name: 'Sign out' }).click();
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
	await page.getByLabel('Language', { exact: true }).selectOption('be');
	await page.getByRole('button', { name: 'Save language' }).click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'be');
	await expect(page.getByRole('heading', { name: 'Акаўнт', exact: true })).toBeVisible();

	const other = await newPage(browser);
	await loginOwnerWithRecovery(other);
	await expect(other.locator('html')).toHaveAttribute('lang', 'be');
	await other.goto('/members');
	await expect(other.locator('html')).toHaveAttribute('lang', 'be');

	await page.getByLabel('Мова', { exact: true }).selectOption('ru');
	await page.getByRole('button', { name: 'Захаваць мову' }).click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
	await page.getByLabel('Язык', { exact: true }).selectOption('en');
	await page.getByRole('button', { name: 'Сохранить язык' }).click();
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
		viewport: { width: 375, height: 812 }
	});
	const page = await context.newPage();
	await page.goto('/login');
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
	const font = await page.request.get('/fonts/herbarium-serif.ttf');
	expect(font.ok()).toBe(true);
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
