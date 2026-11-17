import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';

/**
 * The security core end to end, against a production build with a fresh encrypted data dir.
 * The tests run in order and share state: setup creates the owner, later tests build on it.
 */
test.describe.configure({ mode: 'serial' });

const dataDir = process.env.E2E_DATA_DIR as string;
const ORIGIN = 'http://localhost:4173';
const owner = { username: 'alice', name: 'Alice', password: 'alice has a long password' };
const member = { username: 'bob', name: 'Bob', password: 'bob has a long password too' };
const PROTECTED = ['/', '/members', '/account'];

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

	for (const path of ['/members?/invite', '/account?/changePassword', '/logout']) {
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
