# Architecture

## Current implementation

Herbarium is a SvelteKit application using Svelte 5 runes, strict TypeScript and `adapter-node`. One instance represents one shared circle. Foundation and security core are implemented; calendar, events and media features remain planned in the [roadmap](ROADMAP.md).

| Location                   | Responsibility                                        |
| -------------------------- | ----------------------------------------------------- |
| `src/hooks.server.ts`      | Request authentication and shared request handling    |
| `src/routes/`              | Pages, server loads, form actions and HTTP endpoints  |
| `src/lib/server/config.ts` | Validated configuration through `getConfig()`         |
| `src/lib/server/app.ts`    | Shared server application services                    |
| `src/lib/server/auth/`     | Setup, login, sessions, invites, membership and TOTP  |
| `src/lib/server/crypto/`   | Key loading, derivation, wrapping and secure tokens   |
| `src/lib/server/db/`       | Encrypted SQLite connection and Drizzle schema        |
| `src/lib/server/http/`     | HTTP security and request helpers                     |
| `src/lib/server/audit.ts`  | Security audit events                                 |
| `src/lib/i18n/`            | Paraglide message adapter and locale-aware formatting |
| `src/lib/components/`      | Shared Svelte components                              |
| `src/lib/domain/`          | Shared domain logic                                   |
| `drizzle/`                 | Committed SQL migrations                              |
| `tests/e2e/`               | Playwright browser flows                              |

Server-only operations stay under `src/lib/server/`. Pages use server loads and form actions; inputs are validated on the server. Authentication is enforced by the hook and checked again at route boundaries. Owners manage membership and settings; members share equal content access.

Configuration supplies the master key used for the encrypted SQLite database. Drizzle migrations run at startup. Session cookies carry random tokens while the database stores their hashes. See the [security requirements](../AGENTS.md#security), [key management](key-management.md) and [deployment guide](deployment.md) for details.

## Internationalization

Paraglide compiles `messages/{be,ru,en}.json` through the Vite plugin, using the locally installed MIT-licensed message-format plugin. The typed `messages(locale)` adapter passes the locale to each generated function explicitly; there is no mutable process-global language. Plural variants use CLDR categories through `Intl.PluralRules`.

After authentication, the locale hook uses the member's saved `user.locale`, or negotiates `Accept-Language` when no preference exists. The header's language form posts to the authenticated account action, validates a strict locale allowlist and saves only the current member's preference. A redirect renders the new language without JavaScript. Existing sessions on other devices use the saved preference on their next request. Public and pending second-factor pages use browser-language detection.

Date-only formatting fixes the time zone to UTC to preserve the day; timed formatting requires an explicit event time zone. Week starts follow the supported locales: Monday for Belarusian and Russian, Sunday for English.

## Planned boundaries

Events will share one table with `moment`, `plan` and `occasion` kinds. Date-only values stay `YYYY-MM-DD` strings; timed events store a UTC instant and an IANA time zone. Recurrence will expand at query time.

Media will live as encrypted files on the data volume and will be served through authenticated routes. Maps will use locally served tiles and a local gazetteer. Reminder email will use optional operator-configured SMTP. These are design commitments, not implemented services.

The deployment remains one Node application and one data volume. Runtime assets are self-hosted; user data never goes to third-party APIs. Record boundary changes in [decisions.md](decisions.md).
