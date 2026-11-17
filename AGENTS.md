# AGENTS.md

Primary project guidance for Codex and other coding agents working in this repository.

This file is the source of truth for project context and instructions. Keep shared guidance here; `CLAUDE.md` is a secondary entry point for Claude Code and must not duplicate or override it.

## Project

**Herbarium** is a self-hosted shared calendar for a small circle of people – a couple, a family, close friends. It preserves their shared history, organizes their present and plans their future. It should feel like a personal botanical chronicle or an enchanted herbarium – a place where memories are collected, pressed, preserved and allowed to grow.

Status: phases 0 (foundation) and 1 (security core) are in place. When you add tooling, update the **Commands** section so it always matches reality.

The development plan lives in `docs/ROADMAP.md`. Work phase by phase, and tick off items there as they are completed.

## Documentation and persistent context

- Start at [docs/README.md](docs/README.md) for the documentation index.
- Read [docs/architecture.md](docs/architecture.md) and [docs/development.md](docs/development.md) for implementation context and local workflow.
- Record significant architecture, security and product choices in [docs/decisions.md](docs/decisions.md), including rationale and consequences. Mark proposed and superseded decisions explicitly.
- Update relevant docs in the same change as behavior. Distinguish implemented features from roadmap plans. Keep shared agent instructions here and Claude context secondary.

## Asking questions

Use an available, permitted interactive question tool when clarification is needed, preferring `request_user_input_async`. Allow a custom free-text answer through the tool's built-in option. If no question tool is available or permitted, ask concisely in chat and allow a free-text reply.

License: GPL-3.0. Keep new dependencies GPL-compatible.

## Core functionality

| Feature       | What it does                                                                     |
| ------------- | -------------------------------------------------------------------------------- |
| **Moments**   | Important past events: first meeting, first call, trips, milestones.             |
| **Plans**     | Upcoming activities, dates and trips.                                            |
| **Occasions** | Recurring events such as anniversaries and birthdays.                            |
| **Memories**  | Photos and videos attached to events, albums, chronological browsing.            |
| **Calendar**  | Monthly, weekly and daily views with recurring events and reminders.             |
| **Timeline**  | A chronological visualization of the shared story.                               |
| **Map**       | Events pinned by coordinates on a self-hosted map of memories.                   |
| **Dashboard** | Upcoming events, countdowns, recent memories, "on this day" from previous years. |

Moments, Plans and Occasions are all **events** in one table, distinguished by `kind` (`moment` | `plan` | `occasion`). A Plan becomes a Moment once it has happened – model that as a state change, not a copy. Media belongs to events and can also be grouped into albums independently.

## Tech stack

- **SvelteKit** (Svelte 5 runes) with **TypeScript** in strict mode, `adapter-node`
- **SQLite** via `better-sqlite3-multiple-ciphers` (SQLCipher-compatible encryption at rest), accessed through **Drizzle ORM**; migrations with `drizzle-kit`. The package is installed under the npm alias `better-sqlite3`, because Drizzle's driver imports that name; `openDatabase` refuses to run if the cipher is not active
- **Media** stored encrypted on the local filesystem under a configurable data directory, never in the database. Thumbnails and previews via `sharp` (images) and `ffmpeg` (video posters)
- **Maps** via MapLibre GL JS with self-hosted vector tiles in a single PMTiles file on the data volume; tiles, glyphs and sprites are served by the app itself
- **Recurrence** via RFC 5545 RRULE (`rrule` package); occurrences are expanded at query time, not stored
- **i18n**: Belarusian (`be`), Russian (`ru`) and English (`en`) as equal first-class locales
- **Deployment**: a single Docker image plus one mounted volume holding the SQLite file and media

Prefer the platform and Svelte primitives over extra libraries. Every new dependency must justify itself.

## Commands

```bash
npm run dev          # dev server (needs MASTER_KEY in .env, see .env.example)
npm run build        # production build into build/
npm run start        # run the production build (node build)
npm run check        # svelte-check + TypeScript, warnings fail
npm run lint         # prettier --check + eslint
npm run format       # prettier --write
npm run test         # vitest unit tests (src/**/*.test.ts)
npm run test:e2e     # Playwright (tests/e2e/*.e2e.ts) against a production build
npm run i18n:compile # compile typed messages from messages/{be,ru,en}.json
npm run db:generate  # SQL migration from schema changes (drizzle-kit); the app applies migrations on startup
docker compose up    # local container; needs secrets/master_key, see docs/deployment.md
```

CI (`.github/workflows/ci.yml`) runs audit, check, lint, unit and e2e tests in the `verify` job, then builds the image in the `docker` job and pushes it to Docker Hub (`severnbli/herbarium`) on pushes to `main`, `dev` and `v*` tags.

## Architecture principles

- **Self-hosted and private by default.** No telemetry, no analytics, no third-party CDNs, no external fonts or APIs at runtime. Everything, including fonts, icons and map tiles, is bundled or served locally. The only outbound connection is the optional SMTP server the owners configure for reminder emails.
- **One shared space, any number of members.** One instance = one circle; every member sees and edits all content. Auth is local (see **Security**). Track `createdBy` on records so the UI can show who added what. The only roles are `owner` (the first account; can promote others to owner) and `member`: owners manage invites, members and instance settings, but on content everyone is equal. Do not build per-event permissions or multiple spaces per instance.
- **The data must outlive the app.** One volume = full backup (encrypted SQLite file + encrypted media directory). Keep the schema readable, keep original media at full quality (never re-encoded; only location metadata is removed, see **File uploads**) inside their encryption envelope and provide a full export (JSON + original files) that decrypts on demand for an authenticated user.
- **Server-first.** Use SvelteKit `load` functions and form actions; pages should work without client JS where reasonable. Validate all input on the server (zod or valibot).
- Keep server-only code in `src/lib/server/` so it can never leak into the client bundle.

## Security

This app holds the most private data its members have. Security is a requirement, not a polish step: every change must keep the rules below, and a feature that cannot meet them is not done.

### Cryptography

- Use only vetted primitives from `node:crypto` / WebCrypto and well-maintained libraries. Never implement custom cryptography or invent schemes.
- **Passwords**: argon2id (`@node-rs/argon2`) with at least OWASP-recommended parameters (≥ 19 MiB memory, ≥ 2 iterations). Never log, store or return plaintext passwords.
- **Encryption at rest**:
  - The SQLite database is encrypted with SQLCipher (`better-sqlite3-multiple-ciphers`).
  - Every media file (originals and derivatives) is encrypted with AES-256-GCM using a random per-file data key and a fresh random nonce; data keys are wrapped by the master key and stored in the database. GCM auth tags are always verified before any byte is served.
  - The master key comes from a Docker secret or environment variable, is never written to the data volume, never committed and never logged. Document key rotation and what happens if the key is lost (data is unrecoverable – say so to the user during setup).
- **Randomness**: tokens, IDs exposed in URLs, nonces and salts come from `crypto.randomBytes` / `crypto.getRandomValues` only. Never `Math.random()`.
- **Comparisons** of secrets and token hashes use `crypto.timingSafeEqual`.
- **Transport**: HTTPS is mandatory in production (typically behind a reverse proxy). Send HSTS, set cookies `Secure`, and refuse to start in production without a configured `ORIGIN` on `https://`.

### Authentication and sessions

- Session tokens: 256-bit random values; only their SHA-256 hash is stored in the database. Cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
- Sessions have an idle timeout and an absolute lifetime, are rotated on login and privilege-relevant changes, and are revoked on logout and password change. A "sign out everywhere" action exists.
- Login is rate-limited per IP and per account with exponential backoff; error messages never reveal whether the account exists.
- There is no open registration. After first-run setup creates the owner, new members join only through a single-use, expiring invite token issued by an owner. Owners can revoke unused invites and deactivate members (which revokes all their sessions immediately). At least one active owner must always remain.
- Optional TOTP second factor per user, with single-use recovery codes stored hashed. Sensitive actions (password change, export, deleting data, key operations) require re-entering the password.

### Authorization

- Deny by default: `hooks.server.ts` rejects every request without a valid session, except an explicit allowlist (login, invite acceptance, static assets).
- Every `load`, form action and `+server.ts` endpoint checks the session itself as well – never rely on the client or on hidden UI.
- Media is served only through an authenticated route that decrypts on the fly. Nothing user-uploaded is ever placed in `static/` or exposed by path.

### Injection and input handling

- **SQL injection**: all database access goes through Drizzle's query builder or its `sql` tagged template with bound parameters. Never build SQL by string concatenation or interpolation. Dynamic identifiers (sort column, direction) come from a fixed allowlist.
- **Validation**: every input (form data, query params, route params, JSON bodies, file metadata) is parsed with a schema (zod or valibot) on the server, with length and range limits. Reject unknown fields.
- **XSS**: rely on Svelte escaping. `{@html}` is forbidden for user content, with one exception: event notes are limited Markdown, rendered on the server and sanitized with an allowlist sanitizer (bold, italic, lists, links, line breaks only; links get `rel="noopener noreferrer"`; no raw HTML, images or `javascript:` URLs). Only that sanitized output may be passed to `{@html}`.
- **Command injection**: `ffmpeg` and other binaries run via `execFile`/`spawn` with argument arrays, never through a shell, with timeouts and resource limits.
- **Path traversal**: storage paths are generated server-side from random IDs only; user-supplied file names are kept as metadata and never touch the filesystem.

### Location data

- Event coordinates reveal where the members live and travel – treat them as the most sensitive fields. They live only in the encrypted database, are never logged, never put in reminder emails and never sent to any external service (no external geocoding, tiles or map styles). Place search uses a bundled local gazetteer.
- Map tiles, glyphs and sprites are served only through an authenticated route. CSP for map pages allows only what MapLibre strictly needs (`worker-src blob:`), never `unsafe-eval`.

### File uploads

- Enforce size limits per file and per request. Detect the type from magic bytes, not from the extension or `Content-Type`; allow only an explicit list of image and video formats. SVG and HTML are rejected.
- Decode and re-encode derivatives in a sandboxed way with pixel limits (`sharp` `limitInputPixels`) to stop decompression bombs.
- Extract the capture date from EXIF. EXIF GPS is read in memory only to suggest coordinates for the event; it is stored only if the user accepts, and then only as the event's location. Then remove all location metadata (EXIF GPS, XMP location, QuickTime/MP4 location atoms such as `©xyz`) from the original itself, losslessly and without re-encoding (`exiftool` for images, `ffmpeg -c copy -map_metadata` remux for video, both via `execFile`), before it is encrypted and stored. Derivatives carry no EXIF at all. Other metadata (capture date, orientation) is kept in originals. No file with location data ever reaches the disk, the export or a download.
- Serve media with `X-Content-Type-Options: nosniff`, an exact `Content-Type` and `Content-Disposition`.

### HTTP hardening

- Strict Content Security Policy via SvelteKit `kit.csp` with nonces/hashes: `default-src 'self'`, no `unsafe-inline` scripts, no `unsafe-eval`, `frame-ancestors 'none'`, `object-src 'none'`.
- Also send `Referrer-Policy: same-origin`, a restrictive `Permissions-Policy`, and `Cross-Origin-Opener-Policy: same-origin`. Not `no-referrer`: with it, browsers send `Origin: null` on form posts and the CSRF origin check rejects them; `same-origin` still sends nothing to other sites.
- Keep SvelteKit's built-in CSRF origin check enabled. State-changing operations are never `GET`.
- The PWA service worker caches only versioned static assets – never pages, API responses, media or anything decrypted.
- Error pages and API errors never expose stack traces, SQL or file paths in production.

### Secrets, logging and operations

- Secrets live only in environment variables or Docker secrets; `.env*` is gitignored and `.env.example` contains no real values. Never commit keys, tokens or real user data, including in tests and fixtures.
- Logs never contain passwords, tokens, session IDs, keys, note contents or media. Log security events (logins, failed logins, invites, exports, session revocations) to an audit table.
- The Docker image runs as a non-root user, with a read-only root filesystem except the data volume, and no unnecessary packages.
- Dependencies: keep the lockfile committed, add as few as possible, prefer well-maintained ones, run `npm audit` in CI and treat high/critical findings as blockers.

### Security testing

- Tests cover: unauthenticated access to every route is rejected, session expiry and revocation, rate limiting, invite token reuse/expiry, upload type and size rejection, path traversal attempts, and that encrypted media and database files are unreadable without the key.
- When touching auth, crypto, uploads or data access, review the change against this section before finishing.

## Dates and time – get these right

- **Date-only vs. timed events.** Birthdays, anniversaries and many moments have a date but no time. Store them as plain `YYYY-MM-DD` strings, never as UTC timestamps, or they will shift a day across time zones.
- Timed events store an instant in UTC plus the IANA time zone they were created in.
- Approximate past dates are allowed ("summer 2019", "March 2020"): store a date plus a precision (`day` | `month` | `year`) and render accordingly.
- Recurring occasions on 29 February fall on 28 February in non-leap years.
- Anniversaries show the count ("5th anniversary") computed from the original date.
- Week start, date formats and month names follow the active locale.

## Internationalization

- All user-facing strings go through the i18n layer. No hard-coded text in components, in any language.
- Messages live in Paraglide catalogs at `messages/{en,ru,be}.json`. Components read the typed `messages(data.locale)` adapter in `src/lib/i18n/catalog.ts`; add adapter entries alongside new messages. Pass locales explicitly to generated functions so concurrent server requests stay isolated. Generated files under `src/lib/i18n/paraglide/` are ignored; `npm run check` compiles them automatically.
- Add every new key to all three locales (`be`, `ru`, `en`) in the same change. Belarusian uses Cyrillic and proper Belarusian orthography (і, ў, ' – not Russian substitutes).
- Plural rules differ: use ICU / `Intl.PluralRules`, never `count === 1` logic.
- User content (titles, notes) is not translated.

## Design direction

Traditional **Belarusian botanical art, folklore and natural symbolism**. The app is a herbarium of a shared life: pressed flowers, handwritten labels, linen pages, embroidered borders.

**Visual references**

- _Vycinanka_ (Belarusian paper cutting): symmetric silhouettes for dividers, frames and empty states
- _Ruchnik_ embroidery: geometric red-on-white ornament for borders and accents, used sparingly
- Herbarium sheets: specimens on paper with a small label card (name, date, place)
- Native flora: cornflower (_vasilok_), flax (_lion_), rye, chamomile, clover, oak, birch, and the mythical fern flower (_papars'-kvetka_) of Kupalle

**Palette** (define as CSS custom properties, never inline hex in components)

- Linen and unbleached paper for surfaces
- Madder / embroidery red as the primary accent
- Cornflower blue, moss and rye green, flax and straw gold as secondary
- Ink brown-black for text
- A dark theme that reads as "night of Kupalle": deep forest and indigo surfaces, with the fern flower as a glowing accent

**Typography**: a serif with Cyrillic support for headings and labels (handwritten-label feel), a clean readable sans or serif for body text. Self-hosted only. Must render Belarusian і and ў correctly.

**Metaphor rules**

- The metaphor lives in the visuals and in light touches of copy (a new moment is "pressed" into the herbarium, the timeline grows like a stem). It must never make the UI unclear: buttons and navigation stay plainly labelled.
- Code uses plain domain names (`event`, `media`, `album`), not metaphorical ones.
- Ornament is decoration. Content (photos, notes) always comes first.

**Accessibility**: WCAG AA contrast in both themes, keyboard navigation, `prefers-reduced-motion` respected for all growth/unfolding animations, alt text support for uploaded media.

## Code conventions

- TypeScript strict; no `any` without a comment explaining why.
- Svelte 5 runes (`$state`, `$derived`, `$props`), not legacy stores, unless a library requires it.
- SvelteKit 3: config lives in `vite.config.ts` (no `svelte.config.js`); import shared code via `#lib/...` with the file extension (`#lib/server/config.ts`), and use `$app/env` (not the deprecated `$app/environment`).
- Configuration is read only through `getConfig()` from `src/lib/server/config.ts`, never from `process.env` directly.
- Component files `PascalCase.svelte`; everything else `kebab-case.ts`.
- Styles are scoped component CSS on top of global design tokens. No CSS framework.
- Tests: unit tests (Vitest) for recurrence expansion, date handling and anything in `src/lib/server/`; Playwright for key flows once they exist.

## Git workflow

- **Branches**: `main` is the release branch, `dev` is the integration branch. Work happens on `dev` (or on a short-lived `feature/<name>` branch cut from `dev` and merged back into it).
- **`main` changes only through a pull request from `dev`.** Never commit to `main` directly, never push to `main`, never force-push to `main` or `dev`. This is enforced on GitHub by the "Protect main" ruleset (PR required, CI jobs `verify` and `docker` must pass, no direct pushes, no force-push, no deletion).
- **Commit often, without being reminded.** Commit after every completed logical step: a finished roadmap item, a working sub-feature, a refactor, a docs update. Do not let unrelated work pile up in one commit or leave finished work uncommitted at the end of a task. Push `dev` after committing.
- Before committing: `check`, `lint` and `test` pass (once they exist). Never commit secrets, `.env` files, the data directory or real user data.
- When a commit completes a roadmap item, tick it in `docs/ROADMAP.md` in the same commit.
- Commit messages in English: imperative subject up to ~72 characters, a body explaining why when it is not obvious.

## Writing style

- Never use the em dash (Unicode U+2014). Use the en dash (–) everywhere: code comments, docs, commit messages, UI strings in all locales.
