import { sql } from 'drizzle-orm';
import { blob, check, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Database schema. Keep it readable: the data must outlive the app, so column names say what they
 * hold. All timestamps are UTC instants in milliseconds.
 */

const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });
const createdAt = () =>
	timestamp('created_at')
		.notNull()
		.default(sql`(unixepoch('subsec') * 1000)`);

export const ROLES = ['owner', 'member'] as const;
export type Role = (typeof ROLES)[number];

export const user = sqliteTable('user', {
	id: text('id').primaryKey(),
	/** Login name, stored lowercase. */
	username: text('username').notNull().unique(),
	displayName: text('display_name').notNull(),
	/** Null follows browser language until the member chooses a preference. */
	locale: text('locale', { enum: ['be', 'ru', 'en'] }),
	/** argon2id PHC string. */
	passwordHash: text('password_hash').notNull(),
	role: text('role', { enum: ROLES }).notNull().default('member'),
	/** Set when an owner deactivates the member; deactivated members cannot sign in. */
	deactivatedAt: timestamp('deactivated_at'),
	/** TOTP secret, sealed with the `field` key. Null while 2FA is off. */
	totpSecret: blob('totp_secret', { mode: 'buffer' }),
	/** Secret generated during 2FA setup, until the first code confirms it. */
	totpPendingSecret: blob('totp_pending_secret', { mode: 'buffer' }),
	/** Last accepted TOTP time step, so a code cannot be replayed. */
	totpLastCounter: integer('totp_last_counter'),
	/** Who issued the invite this member joined with; null for the first owner. */
	invitedBy: text('invited_by'),
	createdAt: createdAt(),
	passwordChangedAt: timestamp('password_changed_at')
});

export const session = sqliteTable(
	'session',
	{
		/** SHA-256 of the session token; the token itself lives only in the cookie. */
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** True between a correct password and a correct second factor. */
		mfaPending: integer('mfa_pending', { mode: 'boolean' }).notNull().default(false),
		createdAt: createdAt(),
		lastSeenAt: timestamp('last_seen_at').notNull(),
		/** Absolute end of life, regardless of activity. */
		expiresAt: timestamp('expires_at').notNull(),
		/** Shown in the session list so members recognise their devices. */
		userAgent: text('user_agent')
	},
	(table) => [index('session_user_idx').on(table.userId)]
);

export const invite = sqliteTable('invite', {
	/** SHA-256 of the invite token. */
	id: text('id').primaryKey(),
	/** Public identifier used in the members page to revoke the invite. */
	publicId: text('public_id').notNull().unique(),
	/** Optional note for the owners, e.g. who the invite is for. */
	label: text('label'),
	createdBy: text('created_by')
		.notNull()
		.references(() => user.id),
	createdAt: createdAt(),
	expiresAt: timestamp('expires_at').notNull(),
	usedAt: timestamp('used_at'),
	usedBy: text('used_by').references(() => user.id),
	revokedAt: timestamp('revoked_at')
});

export const recoveryCode = sqliteTable(
	'recovery_code',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** SHA-256 of the normalized code. */
		codeHash: text('code_hash').notNull(),
		usedAt: timestamp('used_at')
	},
	(table) => [index('recovery_code_user_idx').on(table.userId)]
);

/** Failed attempt counters for rate limiting, one row per key such as `ip:…` or `account:…`. */
export const loginAttempt = sqliteTable('login_attempt', {
	key: text('key').primaryKey(),
	failures: integer('failures').notNull(),
	lastFailureAt: timestamp('last_failure_at').notNull(),
	lockedUntil: timestamp('locked_until')
});

export const AUDIT_EVENTS = [
	'setup_completed',
	'login_succeeded',
	'login_failed',
	'login_rate_limited',
	'mfa_failed',
	'logout',
	'session_revoked',
	'sessions_revoked_all',
	'password_changed',
	'reauth_failed',
	'invite_created',
	'invite_revoked',
	'invite_accepted',
	'member_deactivated',
	'member_reactivated',
	'role_changed',
	'totp_enabled',
	'totp_disabled',
	'recovery_code_used',
	'recovery_codes_regenerated',
	'event_deleted'
] as const;
export type AuditEvent = (typeof AUDIT_EVENTS)[number];

/** Security events. Never holds passwords, tokens, keys or content. */
export const auditLog = sqliteTable(
	'audit_log',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		createdAt: createdAt(),
		event: text('event', { enum: AUDIT_EVENTS }).notNull(),
		/** Who did it; null for anonymous attempts. */
		actorId: text('actor_id'),
		/** Whom it affected, if not the actor. */
		targetId: text('target_id'),
		ip: text('ip'),
		/** Small JSON object with non-secret details. */
		details: text('details', { mode: 'json' }).$type<Record<string, string | number | boolean>>()
	},
	(table) => [index('audit_log_created_idx').on(table.createdAt)]
);

/** Moments, plans and (from phase 4) recurring occasions share their identity. */
export const event = sqliteTable(
	'event',
	{
		id: text('id').primaryKey(),
		kind: text('kind', { enum: ['moment', 'plan', 'occasion'] }).notNull(),
		title: text('title').notNull(),
		notes: text('notes').notNull().default(''),
		place: text('place').notNull().default(''),
		lat: real('lat'),
		lon: real('lon'),
		category: text('category', { enum: ['none', 'trip', 'date', 'milestone'] })
			.notNull()
			.default('none'),
		dateMode: text('date_mode', { enum: ['date', 'timed'] }).notNull(),
		precision: text('precision', { enum: ['day', 'month', 'year'] }).notNull(),
		startDate: text('start_date'),
		endDate: text('end_date'),
		startsAt: timestamp('starts_at'),
		endsAt: timestamp('ends_at'),
		timeZone: text('time_zone'),
		/** Local calendar date, also for timed events, for stable sorting and year filters. */
		sortDate: text('sort_date').notNull(),
		createdBy: text('created_by')
			.notNull()
			.references(() => user.id),
		createdAt: createdAt(),
		updatedAt: timestamp('updated_at').notNull()
	},
	(table) => [
		index('event_sort_idx').on(table.sortDate, table.id),
		index('event_kind_sort_idx').on(table.kind, table.sortDate),
		check(
			'event_coordinates',
			sql`(${table.lat} IS NULL AND ${table.lon} IS NULL) OR (${table.lat} IS NOT NULL AND ${table.lon} IS NOT NULL AND ${table.lat} BETWEEN -90 AND 90 AND ${table.lon} BETWEEN -180 AND 180)`
		),
		check(
			'event_dates',
			sql`(${table.dateMode} = 'date' AND ${table.startDate} IS NOT NULL AND ${table.startsAt} IS NULL AND ${table.endsAt} IS NULL AND ${table.timeZone} IS NULL) OR (${table.dateMode} = 'timed' AND ${table.precision} = 'day' AND ${table.startsAt} IS NOT NULL AND ${table.timeZone} IS NOT NULL AND ${table.startDate} IS NULL AND ${table.endDate} IS NULL)`
		)
	]
);
