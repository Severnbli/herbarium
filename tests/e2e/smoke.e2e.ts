import { expect, test } from '@playwright/test';

test('serves the placeholder page', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Herbarium');
});

test('answers the health check', async ({ request }) => {
	const response = await request.get('/healthz');
	expect(response.status()).toBe(200);
	expect(await response.text()).toBe('ok');
});
