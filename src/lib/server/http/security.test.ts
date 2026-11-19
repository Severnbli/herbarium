import { describe, expect, it } from 'vitest';
import { safeNext } from '../auth/guard';
import { isPublicPath, securityHeaders } from './security';

describe('public paths', () => {
	it.each(['/login', '/setup', '/healthz', '/invite/abc_DEF-123'])('%s is public', (path) => {
		expect(isPublicPath(path)).toBe(true);
	});

	it.each([
		'/',
		'/members',
		'/account',
		'/login/verify',
		'/logout',
		'/invite',
		'/invite/a/b',
		'/login/'
	])('%s needs a session', (path) => {
		expect(isPublicPath(path)).toBe(false);
	});
});

describe('safeNext', () => {
	it.each([
		['/members', '/members'],
		[null, '/'],
		['https://evil.example', '/'],
		['//evil.example', '/'],
		['/\\evil.example', '/'],
		['/\t/members', '/'],
		['/events\n', '/'],
		['/calendar?view=week#content', '/calendar?view=week#content'],
		['members', '/']
	])('%s → %s', (next, expected) => {
		expect(safeNext(next)).toBe(expected);
	});
});

describe('security headers', () => {
	it('send HSTS only over HTTPS', () => {
		expect(securityHeaders(true)['strict-transport-security']).toContain('max-age=');
		expect(securityHeaders(false)['strict-transport-security']).toBeUndefined();
		expect(securityHeaders(false)['referrer-policy']).toBe('same-origin');
	});
});
