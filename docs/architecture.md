# Architecture

## Current implementation

Herbarium is a SvelteKit application using Svelte 5 runes, strict TypeScript and `adapter-node`. One instance represents one shared circle. Foundation, security, the design system, three locales, moments, plans and recurring occasions are implemented. Calendar and media remain planned in the [roadmap](ROADMAP.md).

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

Events share one encrypted table with `moment`, `plan` and `occasion` kinds. The event services, schemas, date/notes modules and server-first screens are implemented. Date-only values stay `YYYY-MM-DD` strings, normalized to the first day for month/year precision. Timed events store UTC instants and an IANA time zone, plus the local start date for sorting and year filters.

Media will live as encrypted files on the data volume and will be served through authenticated routes. Maps will use locally served tiles and a local gazetteer. Reminder email will use optional operator-configured SMTP. These are design commitments, not implemented services.

The deployment remains one Node application and one data volume. Runtime assets are self-hosted; user data never goes to third-party APIs. Record boundary changes in [decisions.md](decisions.md).

## Design system

`src/lib/design.css` defines semantic color tokens, typography, controls and the accessibility baseline. Light linen and dark Kupalle themes follow the operating system. The appearance selector stores an optional device preference in localStorage, separate from the account language. A small same-origin script applies the allowlisted theme before first paint, without inline script or a CSP exception. With JavaScript disabled, system appearance and server forms still work.

DejaVu Serif and Sans are bundled under `static/fonts/` with their redistribution license and cover Belarusian і and ў. No font service is contacted. Shared components provide buttons, labelled inputs (`Field`), textareas, selects, precision-aware native date fields, modal dialogs, persistent dismissible status messages and herbarium cards. Decorative inline SVG ornaments are hidden from assistive technology. The app shell includes a skip link, current-page navigation and responsive form layouts.

DatePicker submits the selected precision separately from its date value (day: YYYY-MM-DD, month: YYYY-MM, year: YYYY). Changing precision clears the previous value. Feature actions must validate and normalize these fields on the server before storing them; this visual component does not define event storage.

## Event dates and notes

`src/lib/domain/event-date.ts` uses the ISC-licensed Temporal polyfill to validate calendar dates, convert local clock times to instants, render precision and determine whether an interval has elapsed. Nonexistent DST times are rejected. Repeated local times require explicit earlier/later choices, independently for start and end. Date-only end dates are inclusive; plan completion uses the next UTC day, month or year boundary so a partially elapsed date-only period cannot be completed early.

`src/lib/server/events/schemas.ts` strictly validates fields, bounded notes, paired coordinates, chronological ends and list filters. `notes.ts` renders a small Markdown subset with markdown-it (raw HTML and images disabled), then sanitizes with sanitize-html. Only paragraphs, bold, italic, lists, links and line breaks survive. Links use allowlisted schemes and forced `rel="noopener noreferrer"`. Both dependencies are MIT-licensed and server-only.

`src/lib/server/events/events.ts` provides validated create/update/delete operations, author-preserving plan completion and paginated list queries. Lists filter by the local start year and kind and return 30 records per page, ordered by local start date and random identifier. SQL is built through Drizzle with bound parameters. Authenticated routes under `/events` provide a paginated list, kind/year filters, a create form, detail pages and edit forms. Every load and action checks its session independently of the hook. Members can edit all events; the author stays unchanged. Deleting an event requires rate-limited password confirmation and writes a content-free audit event in the same transaction.

Event forms accept bounded text dates in the displayed formats, so selecting a different precision or timed mode works without client JavaScript. Failed submissions return known, bounded field values and field identifiers; password values are never returned. Kind, category and date/clock options are fully translated in all three locales. Detail pages render the server-sanitized notes HTML as the only user-content `{@html}` exception.

## Occasions and recurrence

Occasions share the event table and store a single RRULE and occasion type alongside their original event dates. `listOccurrences` expands starts over an inclusive local-date range of at most 367 dates. Occurrence rows are computed on demand. The event list still shows one row per original event and filters by its original local start year. Event details show the recurrence summary and up to five occurrences in the coming year.

The server accepts yearly and monthly presets, and custom daily, weekly, monthly or yearly intervals from 1 to 99. Anniversaries and birthdays use the yearly preset and count the years elapsed since the original date. Yearly February 29 occasions fall on February 28 in non-leap years. Monthly rules skip months without the original day. Timed occurrences retain local wall time and elapsed duration. DST gaps are skipped, future repeated clock times use the earlier instant and the original occurrence retains its saved instant.
