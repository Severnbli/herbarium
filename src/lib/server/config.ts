import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

/**
 * Runtime configuration, read once from the environment at server start.
 *
 * Secrets (the master key) are kept out of error messages and are never logged.
 */
export interface Config {
	/** Public origin of the app, e.g. `https://herbarium.example.org`. */
	origin: URL;
	/** Absolute path of the data directory holding the database and media. */
	dataDir: string;
	/** 256-bit master key. Never log or serialize this value. */
	masterKey: Buffer;
	limits: {
		/** Maximum size of one uploaded file in bytes. */
		maxFileBytes: number;
		/** Maximum size of one upload request in bytes. */
		maxRequestBytes: number;
	};
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

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const byteLimit = (fallback: number) =>
	z.coerce
		.number()
		.int()
		.positive()
		.max(64 * GiB)
		.default(fallback);

const envSchema = z.object({
	ORIGIN: z.string().trim().optional(),
	DATA_DIR: z.string().trim().min(1).optional(),
	MASTER_KEY: z.string().trim().optional(),
	MASTER_KEY_FILE: z.string().trim().optional(),
	MAX_FILE_BYTES: byteLimit(GiB),
	MAX_REQUEST_BYTES: byteLimit(2 * GiB)
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
		limits: { maxFileBytes: vars.MAX_FILE_BYTES, maxRequestBytes: vars.MAX_REQUEST_BYTES },
		production
	};
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

	let encoded: string;
	if (file) {
		try {
			encoded = readFile(file).trim();
		} catch {
			issues.push('MASTER_KEY_FILE could not be read');
			return undefined;
		}
	} else {
		encoded = inline as string;
	}

	const key = decodeKey(encoded);
	if (!key) {
		issues.push(
			`the master key must be exactly ${MASTER_KEY_BYTES} bytes, encoded as base64 or hex. ` +
				'Generate one with: openssl rand -base64 32'
		);
		return undefined;
	}
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
