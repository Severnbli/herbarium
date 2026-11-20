import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

/**
 * Runtime configuration, read once from the environment at server start.
 *
 * Secrets (the master key) are kept out of error messages and are never logged.
 */
export interface SmtpConfig {
	host: string;
	port: number;
	from: string;
	tls: 'implicit' | 'starttls';
	auth: { user: string; pass: string };
}

export interface Config {
	/** Public origin of the app, e.g. `https://herbarium.example.org`. */
	origin: URL;
	/** Absolute path of the data directory holding the database and media. */
	dataDir: string;
	/** 256-bit master key. Never log or serialize this value. */
	masterKey: Buffer;
	/** Optional previous key for startup rotation. */
	masterKeyPrevious?: Buffer;
	limits: {
		/** Maximum size of one uploaded file in bytes. */
		maxFileBytes: number;
		/** Maximum size of one upload request in bytes. */
		maxRequestBytes: number;
	};
	mediaToolEnv: { PATH: string; PERL5LIB?: string };
	smtp: SmtpConfig | null;
	production: boolean;
}

export class ConfigError extends Error {
	constructor(public readonly issues: string[]) {
		super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
		this.name = 'ConfigError';
	}
}

const MASTER_KEY_BYTES = 32;
const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const MAX_UPLOAD_BYTES = GiB + MiB;
const binaryByteUnits = new Map([
	['kib', 1024],
	['mib', MiB],
	['gib', GiB]
]);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const byteLimit = (fallback: number, maximum: number) =>
	z.preprocess((raw) => {
		if (typeof raw !== 'string') return raw;
		const match = /^(\d+)\s*(kib|mib|gib)$/i.exec(raw.trim());
		if (!match) return raw;
		const [, quantity, unit] = match;
		return Number(quantity) * binaryByteUnits.get(unit!.toLowerCase())!;
	}, z.coerce.number().int().positive().max(maximum).default(fallback));

const envSchema = z.object({
	ORIGIN: z.string().trim().optional(),
	DATA_DIR: z.string().trim().min(1).optional(),
	MASTER_KEY: z.string().trim().optional(),
	MASTER_KEY_FILE: z.string().trim().optional(),
	MASTER_KEY_PREVIOUS_FILE: z.string().trim().optional(),
	MAX_FILE_BYTES: byteLimit(128 * MiB, GiB),
	MAX_REQUEST_BYTES: byteLimit(129 * MiB, MAX_UPLOAD_BYTES),
	PATH: z.string().min(1).default('/usr/local/bin:/usr/bin:/bin'),
	PERL5LIB: z.string().optional(),
	SMTP_HOST: z.hostname().max(253).optional(),
	SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
	SMTP_FROM: z.email().max(254).optional(),
	SMTP_TLS: z.enum(['implicit', 'starttls']).optional(),
	SMTP_CREDENTIALS_FILE: z.string().trim().min(1).optional()
});

export type Env = Record<string, string | undefined>;

export interface LoadOptions {
	production: boolean;
	/** Base for resolving a relative `DATA_DIR`. Defaults to the working directory. */
	cwd?: string;
	/** Injected for tests; defaults to reading the file from disk. */
	readFile?: (path: string) => string;
}

/**
 * Parses and validates the configuration. Throws `ConfigError` listing every problem at once,
 * so the operator can fix them in one go.
 */
export function loadConfig(env: Env, options: LoadOptions): Config {
	const {
		production,
		cwd = process.cwd(),
		readFile = (path) => readFileSync(path, 'utf8')
	} = options;
	const issues: string[] = [];

	// Treat empty strings like unset variables, as `.env` files often contain `KEY=`.
	const cleaned = Object.fromEntries(
		Object.keys(envSchema.shape).map((key) => [key, env[key] === '' ? undefined : env[key]])
	);
	const parsed = envSchema.safeParse(cleaned);
	if (!parsed.success) {
		// Report only the variable names and the rule, never the values.
		throw new ConfigError(
			parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
		);
	}
	const vars = parsed.data;

	const origin = parseOrigin(vars.ORIGIN, production, issues);
	const masterKey = loadMasterKey(vars.MASTER_KEY, vars.MASTER_KEY_FILE, readFile, issues);
	const masterKeyPrevious = vars.MASTER_KEY_PREVIOUS_FILE
		? readKeyFile(vars.MASTER_KEY_PREVIOUS_FILE, 'MASTER_KEY_PREVIOUS_FILE', readFile, issues)
		: undefined;
	if (masterKey && masterKeyPrevious && timingSafeEqual(masterKey, masterKeyPrevious)) {
		issues.push('MASTER_KEY_PREVIOUS_FILE must contain a different master key');
	}
	const smtp = loadSmtpConfig(vars, readFile, issues);

	if (production && !vars.DATA_DIR) {
		issues.push('DATA_DIR is required in production');
	}
	const dataDir = resolveDataDir(vars.DATA_DIR ?? 'data', cwd);

	if (vars.MAX_FILE_BYTES > vars.MAX_REQUEST_BYTES) {
		issues.push('MAX_FILE_BYTES must not exceed MAX_REQUEST_BYTES');
	}

	if (issues.length > 0 || !origin || !masterKey) {
		throw new ConfigError(issues);
	}

	return {
		origin,
		dataDir,
		masterKey,
		masterKeyPrevious,
		limits: { maxFileBytes: vars.MAX_FILE_BYTES, maxRequestBytes: vars.MAX_REQUEST_BYTES },
		mediaToolEnv: { PATH: vars.PATH, PERL5LIB: vars.PERL5LIB },
		smtp,
		production
	};
}

const smtpCredentials = z.strictObject({
	user: z.string().min(1).max(1024),
	pass: z.string().min(1).max(4096)
});

function loadSmtpConfig(
	vars: z.output<typeof envSchema>,
	readFile: (path: string) => string,
	issues: string[]
): SmtpConfig | null {
	const {
		SMTP_HOST: host,
		SMTP_PORT: port,
		SMTP_FROM: from,
		SMTP_TLS: tls,
		SMTP_CREDENTIALS_FILE: secretFile
	} = vars;
	if (!host && !port && !from && !tls && !secretFile) return null;
	if (!host || !from || !secretFile) {
		issues.push('SMTP_HOST, SMTP_FROM and SMTP_CREDENTIALS_FILE are required to enable mail');
		return null;
	}
	let raw: string;
	try {
		raw = readFile(secretFile);
	} catch {
		issues.push('SMTP_CREDENTIALS_FILE could not be read');
		return null;
	}
	try {
		const auth = smtpCredentials.parse(JSON.parse(raw));
		const mode = tls ?? (port === 465 ? 'implicit' : 'starttls');
		return { host, port: port ?? (mode === 'implicit' ? 465 : 587), from, tls: mode, auth };
	} catch {
		issues.push('SMTP_CREDENTIALS_FILE must contain a JSON object with user and pass strings');
		return null;
	}
}

function parseOrigin(raw: string | undefined, production: boolean, issues: string[]) {
	if (!raw) {
		if (production) {
			issues.push('ORIGIN is required in production, e.g. https://herbarium.example.org');
			return undefined;
		}
		return new URL('http://localhost:5173');
	}

	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		issues.push('ORIGIN must be an absolute URL, e.g. https://herbarium.example.org');
		return undefined;
	}

	if (url.origin !== raw.replace(/\/$/, '')) {
		issues.push('ORIGIN must be an origin only: scheme, host and optional port, no path');
		return undefined;
	}

	if (url.protocol === 'https:') {
		return url;
	}
	// Plain HTTP is accepted in production only on loopback, where browsers still treat the page
	// as a secure context. This keeps local production builds testable without a public HTTP hole.
	if (url.protocol === 'http:' && (!production || LOOPBACK_HOSTS.has(url.hostname))) {
		return url;
	}
	issues.push(
		production
			? 'ORIGIN must use https:// in production (plain http:// is allowed only for localhost)'
			: 'ORIGIN must use http:// or https://'
	);
	return undefined;
}

function loadMasterKey(
	inline: string | undefined,
	file: string | undefined,
	readFile: (path: string) => string,
	issues: string[]
) {
	if (inline && file) {
		issues.push('set either MASTER_KEY or MASTER_KEY_FILE, not both');
		return undefined;
	}
	if (!inline && !file) {
		issues.push(
			'a master key is required: set MASTER_KEY_FILE (Docker secret) or MASTER_KEY. ' +
				'Generate one with: openssl rand -base64 32'
		);
		return undefined;
	}

	if (file) return readKeyFile(file, 'MASTER_KEY_FILE', readFile, issues);
	const key = decodeKey(inline!);
	if (!key) {
		issues.push(
			`the master key must be exactly ${MASTER_KEY_BYTES} bytes, encoded as base64 or hex. ` +
				'Generate one with: openssl rand -base64 32'
		);
		return undefined;
	}
	return key;
}

function readKeyFile(
	path: string,
	variable: 'MASTER_KEY_FILE' | 'MASTER_KEY_PREVIOUS_FILE',
	readFile: (path: string) => string,
	issues: string[]
): Buffer | undefined {
	let encoded: string;
	try {
		encoded = readFile(path).trim();
	} catch {
		issues.push(`${variable} could not be read`);
		return undefined;
	}
	const key = decodeKey(encoded);
	if (!key) issues.push(`${variable} must contain a 32-byte key encoded as base64 or hex`);
	return key;
}

function decodeKey(encoded: string): Buffer | undefined {
	if (/^[0-9a-fA-F]{64}$/.test(encoded)) {
		return Buffer.from(encoded, 'hex');
	}
	if (/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
		const key = Buffer.from(encoded, 'base64');
		return key.length === MASTER_KEY_BYTES ? key : undefined;
	}
	return undefined;
}

function resolveDataDir(dir: string, cwd: string) {
	return isAbsolute(dir) ? dir : resolve(cwd, dir);
}

let current: Config | undefined;

/** Loads the configuration once at server start. Throws `ConfigError` if it is invalid. */
export function initConfig(env: Env, options: LoadOptions): Config {
	current = loadConfig(env, options);
	return current;
}

/** Returns the configuration loaded by `initConfig`. */
export function getConfig(): Config {
	if (!current) {
		throw new Error('Configuration accessed before initConfig() was called');
	}
	return current;
}
