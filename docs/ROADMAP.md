# Roadmap

Development plan for Herbarium. Phases are ordered by dependency: each one builds on the previous and ends in a working, tested, deployable state. Security and encryption come first on purpose – retrofitting them onto existing data is painful and error-prone.

Status legend: `[ ]` not started, `[~]` in progress, `[x]` done.

**MVP** = phases 0–5: members of a circle can log in securely, record moments, plans and occasions, attach photos, and see them in a list. Phases 6–10 turn it into the full chronicle.

---

## Phase 0 – Foundation

Goal: an empty but production-shaped app.

- [x] Scaffold SvelteKit (Svelte 5, TypeScript strict, `adapter-node`)
- [x] ESLint + Prettier, `svelte-check`, Vitest, Playwright
- [x] Project layout: `src/lib/server/`, `src/lib/components/`, `src/lib/domain/`, `src/lib/i18n/`
- [x] Typed config loader validated at startup (`ORIGIN`, data dir, master key source, limits); refuses to start in production without HTTPS origin or key
- [x] `.env.example`, `.gitignore` (incl. `.env*`, data dir)
- [x] Dockerfile: multi-stage, non-root user, read-only root FS, data volume; `docker-compose.yml` example with Docker secret for the master key
- [x] CI: check, lint, unit tests, `npm audit` (high/critical blocks); e2e smoke test; image published to Docker Hub
- [x] Add the CI jobs (`verify`, `docker`) as required status checks to the "Protect main" GitHub ruleset
- [x] Update **Commands** in `CLAUDE.md`

Done when: `docker compose up` serves a placeholder page; CI is green.

## Phase 1 – Security core

Goal: encrypted storage and authentication before any user data exists.

- [ ] SQLite via `better-sqlite3-multiple-ciphers` (SQLCipher), Drizzle schema, `drizzle-kit` migrations run on startup
- [ ] Key management module: master key loading, data-key generation and wrapping (AES-256-GCM), unit-tested; key rotation procedure designed (implemented in phase 10)
- [ ] Tables: `user`, `session`, `invite`, `audit_log`, `login_attempt`
- [ ] First-run setup: create first account, explicit warning that a lost key means lost data
- [ ] Roles `owner` / `member`; owners issue single-use, expiring invites, revoke them, deactivate members (revoking their sessions) and promote/demote owners; at least one active owner always remains; no open registration
- [ ] Members page: list, invite, deactivate
- [ ] argon2id hashing; login with rate limiting + backoff; generic errors
- [ ] Sessions: random 256-bit token, stored hashed, cookie flags, idle + absolute expiry, rotation, logout, "sign out everywhere"
- [ ] Re-auth helper for sensitive actions; password change revokes other sessions
- [ ] `hooks.server.ts`: deny-by-default auth guard with explicit allowlist
- [ ] Security headers + strict CSP (`kit.csp`), CSRF check on, safe production error pages
- [ ] Audit logging of security events
- [ ] Optional TOTP 2FA per user, with single-use recovery codes stored hashed (may slip to phase 10 if it blocks progress)
- [ ] Tests: every route rejects anonymous access, owner-only actions reject members, deactivated members are locked out, session expiry/revocation, rate limit, invite reuse/expiry, DB unreadable without key

Done when: the owner can invite members, members can log in, deactivation locks them out immediately; the DB file is unreadable without the key.

## Phase 2 – Design system and i18n

Goal: the herbarium look and three languages, before feature screens multiply.

- [ ] i18n layer (Paraglide JS) with `be`, `ru`, `en`; locale detection + switcher saved per user; ICU plurals; locale-aware dates and week start
- [ ] Design tokens as CSS custom properties: linen/paper surfaces, madder red, cornflower, moss, rye, flax gold, ink
- [ ] Two themes: light (linen) and dark ("Kupalle night"), following system preference with manual override
- [ ] Self-hosted fonts with full Belarusian Cyrillic (і, ў) coverage
- [ ] Ornament set as inline SVG: vycinanka dividers and frames, ruchnik borders, plant motifs for empty states
- [ ] Base components: button, input, textarea, select, date picker (supports day/month/year precision), dialog, toast, card ("herbarium sheet" with label), app shell with navigation
- [ ] Accessibility baseline: AA contrast in both themes, focus styles, keyboard nav, `prefers-reduced-motion`
- [ ] Restyle login/setup/invite screens with the new system

Done when: auth screens look finished in both themes and all three locales.

## Phase 3 – Events: Moments and Plans

Goal: the core domain.

- [ ] `event` table: `kind` (moment/plan/occasion), title, notes (limited Markdown source), place (plain text) plus optional coordinates (`lat`/`lon`, validated ranges, entered as numbers until the map picker lands in phase 8), all-day date (`YYYY-MM-DD`) or timed (UTC instant + IANA tz), date precision, optional end, `createdBy`, timestamps
- [ ] Domain module for date handling (all-day vs timed, precision rendering, time zones) with thorough unit tests
- [ ] Server-side validation schemas for all event inputs
- [ ] Notes in limited Markdown (bold, italic, lists, links, line breaks): rendered on the server, sanitized with an allowlist, links forced to `rel="noopener noreferrer"`; tests with XSS payloads
- [ ] Create / edit / delete moments and plans (form actions, works without JS)
- [ ] Plan → moment transition once it has happened (state change, optional prompt to add memories)
- [ ] Event list and detail page; simple filters by kind and year
- [ ] Tags or categories (trip, date, milestone…) – keep minimal

Done when: all members can record and edit past and future events with correct dates in any time zone.

## Phase 4 – Occasions and recurrence

- [ ] RRULE storage on occasions; expansion at query time for a given range
- [ ] Yearly occasions from an original date: anniversaries with ordinal count ("5th"), birthdays with age
- [ ] 29 February → 28 February in non-leap years
- [ ] Recurrence editor UI (yearly / monthly / custom) with human-readable summary in all locales
- [ ] Tests: expansion across DST, leap years, ranges, ordinals per locale

Done when: occasions recur correctly and show their count.

## Phase 5 – Memories (media)

Goal: encrypted photos and videos attached to events. Completes the MVP.

- [ ] Encrypted file format: chunked AEAD (AES-256-GCM per fixed-size segment, counter-derived nonces, authenticated header) so videos can be streamed with HTTP range requests without decrypting the whole file
- [ ] Upload pipeline: size limits, magic-byte type detection with allowlist (no SVG/HTML), random storage IDs, streaming encryption
- [ ] Derivatives: `sharp` thumbnails and previews with `limitInputPixels`; `ffmpeg` video posters via `execFile` with timeouts; EXIF capture date extracted; EXIF GPS read in memory only to offer it as the event's coordinates (stored only if the user accepts, as the event's location), then all location metadata (EXIF GPS, XMP, video location atoms) removed losslessly from the original before encryption (`exiftool` for images, `ffmpeg -c copy` remux for video); derivatives carry no EXIF at all
- [ ] Authenticated media route: decrypt on the fly, range support, `nosniff`, exact `Content-Type`, `Content-Disposition`
- [ ] Attach media to events; alt text and captions
- [ ] Albums independent of events; chronological gallery; lightbox with keyboard navigation
- [ ] Tests: type/size rejection, path traversal attempts, tampered ciphertext rejected, files unreadable without key, no GPS/location metadata in stored originals, derivatives or downloads (JPEG, HEIC, PNG, MP4, MOV fixtures), originals not re-encoded

Done when: photos and videos upload, display and stream, and the media directory contains only ciphertext. **MVP release (v0.1).**

## Phase 6 – Calendar

- [ ] Month, week and day views over expanded events (moments, plans, occasions)
- [ ] Locale-aware week start and formats; today indicator; navigation and jump-to-date
- [ ] Quick create from a calendar cell
- [ ] Reminders: per-event offsets, per-user preferences; background scheduler in the Node process that survives restarts (due reminders stored in the DB, sent at most once)
- [ ] Email delivery via the owners' own SMTP server: optional config, TLS required, credentials as a Docker secret; emails in the recipient's locale, carrying only title, date and a link – never notes or media
- [ ] Tests: scheduling across time zones and DST, no duplicate sends after restart, SMTP failure retries
- [ ] Responsive layout: month view usable on a phone

## Phase 7 – Timeline

- [ ] Chronological visualization of the shared story as a growing stem: events as leaves/flowers, years as nodes
- [ ] Handles approximate dates (month/year precision) gracefully
- [ ] Media previews on the timeline; filters by kind/tag
- [ ] Lazy loading / virtualization for long histories
- [ ] Growth animations that fully respect `prefers-reduced-motion`

## Phase 8 – Map of memories

Goal: see where the shared story happened, without any request leaving the server.

- [ ] Self-hosted vector tiles: one PMTiles file (e.g. Belarus + Europe extract from OpenStreetMap) on the data volume; documented download/update step; OSM attribution shown
- [ ] Tiles, glyphs (fonts) and sprites served from the app through an authenticated route with HTTP range support – no external tile, font or style URLs
- [ ] MapLibre GL JS + `pmtiles` protocol, loaded only on map pages
- [ ] Custom herbarium map style: linen land, muted ink roads, cornflower water, moss forests; a "Kupalle night" variant for the dark theme; labels in the active locale where data allows
- [ ] Map picker on the event form: click/drag a pin, paste coordinates, or accept the point suggested from an uploaded photo's GPS; clear button
- [ ] Local place search: bundled GeoNames gazetteer (populated places with `be`/`ru`/`en` names) in a local SQLite table with full-text search; no external geocoder; CC BY attribution to GeoNames
- [ ] Map on the event detail page
- [ ] Map of memories view: all events with coordinates as botanical markers, clustering, filters by kind/year/tag, popup with title, date and preview
- [ ] CSP updated for MapLibre (`worker-src blob:` and the minimum needed – no `unsafe-eval`)
- [ ] Keyboard-accessible alternative: list of places next to the map
- [ ] Tests: coordinate validation, tile route rejects anonymous access, no outbound requests from map pages

Done when: events can be pinned and browsed on a map that works fully offline from the internet.

## Phase 9 – Dashboard

- [ ] Upcoming events and occasions with countdowns
- [ ] Recent memories
- [ ] "On this day" from previous years
- [ ] Next anniversary highlight; time together counter
- [ ] Becomes the home page after login

## Phase 10 – Data ownership and operations

- [ ] Full export (JSON + original files without location metadata, zip, streamed) behind re-auth; audit-logged; event coordinates included in the JSON
- [ ] Import from an export (restore into a fresh instance)
- [ ] Bulk photo/video import from a phone gallery or folder: multi-file upload with progress and resume, grouped by EXIF capture date into suggested moments/albums the user confirms; GPS suggestions as in phase 5; duplicate detection by a keyed hash (HMAC) of the uploaded bytes, computed before metadata removal
- [ ] Master key rotation (re-wrap data keys, re-key SQLCipher)
- [ ] Backup and restore guide; a tested restore procedure in CI
- [ ] Optional TOTP 2FA if it slipped from phase 1

## Phase 11 – Polish and v1.0

- [ ] PWA: installable with app icon and splash in the herbarium style; no offline mode – the service worker caches only versioned static assets, never pages, API responses or media
- [ ] Performance pass: query indexes, image sizes, bundle size
- [ ] Full accessibility audit in both themes and all locales
- [ ] Security review against the **Security** section of `CLAUDE.md`; dependency review
- [ ] README: features, screenshots, deployment with reverse proxy and HTTPS, configuration reference
- [ ] **v1.0 release**

---

## Decisions

- **Members**: one shared space per instance with any number of members (a couple, a family, friends). Roles: `owner` and `member`; equal rights on content, owners manage members and settings. No multiple spaces per instance.
- **Reminders**: delivered by email through the owners' own SMTP server. No Web Push (it routes through browser vendors' services) and no messenger bots.
- **Places**: plain-text name plus optional coordinates on events, and a map of memories. Tiles are self-hosted PMTiles rendered with MapLibre – no external tile, style or font requests. Place search uses a bundled GeoNames gazetteer. GPS from a photo's EXIF is offered as a suggestion for the event's coordinates at upload, then stripped from the files, including the originals – no stored, exported or downloaded file contains location data.
- **Notes**: limited Markdown, rendered and sanitized on the server.
- **ICS feed**: not planned. Data stays inside the app.
- **Imports**: only bulk photo/video upload (plus restoring Herbarium's own export). No Google Takeout or ICS import.
- **Encryption at rest**: kept for the database and all media. A lost master key means lost data; setup warns about this.
- **2FA**: optional TOTP per user with recovery codes.
- **PWA**: installable, no offline mode, no user data cached on devices.
- **Styling**: own CSS on design tokens, no CSS framework.

## Open questions

None at the moment. Add new ones here as they come up.
