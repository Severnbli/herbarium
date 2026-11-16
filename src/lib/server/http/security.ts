/**
 * Paths reachable without a session. Everything else needs a signed-in member: deny by default.
 * Static files and built assets are served by adapter-node before hooks run.
 */
const PUBLIC_PATHS = new Set(['/login', '/setup', '/healthz']);
const PUBLIC_PATTERNS = [/^\/invite\/[A-Za-z0-9_-]{1,64}$/];

/** Paths a member who passed the password but not yet the second factor may use. */
export const MFA_PATHS = new Set(['/login/verify', '/logout']);

export function isPublicPath(pathname: string): boolean {
	return PUBLIC_PATHS.has(pathname) || PUBLIC_PATTERNS.some((pattern) => pattern.test(pathname));
}

const PERMISSIONS_POLICY = [
	'accelerometer=()',
	'autoplay=()',
	'browsing-topics=()',
	'camera=()',
	'display-capture=()',
	'geolocation=()',
	'gyroscope=()',
	'magnetometer=()',
	'microphone=()',
	'midi=()',
	'payment=()',
	'publickey-credentials-get=()',
	'serial=()',
	'usb=()',
	'xr-spatial-tracking=()'
].join(', ');

/** Headers added to every response. The CSP itself comes from `kit.csp` in vite.config.ts. */
export function securityHeaders(https: boolean): Record<string, string> {
	return {
		// Not `no-referrer`: with it, browsers send `Origin: null` on form posts, which defeats the
		// CSRF origin check. `same-origin` still sends nothing to any other site.
		'referrer-policy': 'same-origin',
		'x-content-type-options': 'nosniff',
		'x-frame-options': 'DENY',
		'cross-origin-opener-policy': 'same-origin',
		'cross-origin-resource-policy': 'same-origin',
		'permissions-policy': PERMISSIONS_POLICY,
		...(https ? { 'strict-transport-security': 'max-age=63072000; includeSubDomains' } : {})
	};
}
