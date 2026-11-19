# Decisions

These decisions were established before the Codex adaptation. This log preserves their rationale and scope; acceptance does not mean every feature is implemented. Check [ROADMAP.md](ROADMAP.md) for delivery status.

## Accepted product and architecture decisions

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
- **First-run setup**: guarded by a one-time code the app writes to `setup-code` on the data volume (never logged), deleted once the owner exists.
- **Referrer policy**: `same-origin` instead of `no-referrer`, because `no-referrer` makes browsers send `Origin: null` on form posts and breaks the CSRF origin check.

## Agent context

Status: accepted.

Use root `AGENTS.md` as the authoritative instructions for Codex and other coding agents. Keep `CLAUDE.md` as a secondary entry point that imports it. This preserves Claude compatibility while avoiding two copies of project policy that can drift. Update shared guidance only in `AGENTS.md`.

## Recording future decisions

For a significant change to architecture, security, dependencies, data formats or product scope, append a record with:

- A stable heading and status: proposed, accepted or superseded.
- Context: the concrete problem and constraints.
- Decision: the selected approach and why it was selected.
- Alternatives: relevant options and why they were set aside.
- Consequences: costs, limitations, migration needs and affected documentation.

Do not invent historical rationale or approval dates. Mark proposals clearly. Keep superseded decisions with a link to their replacement. Small implementation details belong in code or a commit message.

## Compiled translations and saved member locales

Status: accepted.

Replace the interim TypeScript dictionaries with Paraglide JSON catalogs and a typed adapter that preserves the existing component API. Paraglide and its message-format plugin are MIT-licensed development dependencies, justified by typed message generation and locale-specific plural variants. Load the format plugin from the installed package rather than a CDN to keep builds reproducible and runtime traffic local.

Pass the locale explicitly to every generated message call. A global locale would risk mixing languages across concurrent server requests. Preserve the small adapter rather than rewriting every auth component; adding a message now requires a catalog entry and an adapter entry.

Store a nullable locale on the encrypted user record. Null preserves browser-language detection for existing accounts; an explicit preference follows the member across devices. A server form action changes only the authenticated member's preference and redirects, preserving operation without client JavaScript. No public locale endpoint or extra cookie is needed. English uses the CLDR default Sunday week start; Belarusian and Russian use Monday.

## Local typography and device appearance

Status: accepted.

Use bundled DejaVu Serif and Sans, distributed under their included permissive font license, for full Belarusian Cyrillic coverage without runtime font requests or another npm dependency. The fonts add approximately 1.1 MiB of static assets; `font-display: swap` keeps text visible while they load.

Keep appearance on the device with an allowlisted localStorage preference. System appearance remains the default and works without JavaScript. A small external same-origin script applies manual overrides before paint under the existing strict CSP. Language remains an account preference. A database theme column would add a migration and require authentication for a preference also useful on login and setup screens.

Use native date, month and four-digit year inputs for the initial precision picker. This provides browser keyboard support and progressive form submission without introducing a date-picker dependency. Event validation and normalization belong to phase 3 server schemas.

## Event date precision, DST and restricted notes

Status: accepted.

Use `@js-temporal/polyfill` (ISC), rather than custom offset calculations, to validate real calendar dates and convert local inputs under IANA zone rules. Reject nonexistent clock times. Ask for an explicit earlier/later occurrence for repeated times, independently for start and end, and preserve the selected instants when editing. Date-only values remain strings; approximate dates normalize to the first day of the selected period. Date-only plans finish only after the final UTC date/month/year boundary has elapsed; timed plans finish at their end instant, or their start when no end is supplied.

Use markdown-it and sanitize-html (both MIT) for event notes. Parser restrictions provide the small supported syntax; a separate explicit HTML allowlist provides the security boundary. Store Markdown source, render on the server, forbid raw HTML/images and force safe link relations. These dependencies replace fragile custom Markdown or HTML parsing and are kept out of client bundles.

Start with one optional fixed category (`trip`, `date`, `milestone`) rather than a tag-management service. The event table retains one identity when a plan becomes a moment. A local sort date permits indexed year filtering without interpreting date-only values as instants.

## Server-first event forms and deletion

Status: accepted.

Event forms use explicit text date formats with separate mode and precision selectors. This keeps every create/edit flow usable without JavaScript, including approximate dates and arbitrary time zones. The shared native DatePicker remains available for progressively enhanced feature screens; it is not the event validation boundary. Server errors preserve bounded known fields, reject duplicate and unknown fields and never echo passwords.

Every member can edit or delete any event, preserving the circle's equal content access. Deletion is permanent and requires the acting member's password through the existing rate-limited re-authentication service. Record only the event identifier, actor and client address in the audit log, atomically with deletion; never include title, notes, place or coordinates. Completing a plan changes its kind in place, and the edit path enforces the same elapsed-period rule.

## Occasion rules and local-date expansion

Status: accepted.

Store an RFC 5545 frequency and interval on the original encrypted event row. The BSD-3-Clause `rrule` library generates candidate dates within the requested range. The editor exposes yearly and monthly presets and custom daily, weekly, monthly and yearly intervals. Keeping the supported rule fields bounded limits query cost and makes every supported rule editable and summarizable in all three locales.

Use the original date and local clock as the anchor. For yearly February 29 occasions, choose the last of February 28 and 29 so the occasion occurs once every selected year. For timed occasions, resolve each candidate with Temporal in the saved time zone, skip gaps and use the earlier instant for future folds. Preserve the original instant and the elapsed duration of timed events. Date-only event spans retain their original number of days.

## Temporary Picomatch fork for build tooling

Status: accepted.

CVE-2026-112366 affects Picomatch through version 4.0.7, and the advisory lists no fixed release. Vite, Vitest, Svelte Check and Paraglide bring it into the development dependency tree. Use a local MIT-licensed fork of 4.0.7 for those tools until a fixed upstream release is available. The fork rejects repeated extglobs before producing their regular expressions. Ordinary wildcards, brace alternatives and non-repeating extglobs remain available.

The override resolves to the tracked source under `vendor/picomatch`, which GitHub Actions and Docker both install with `npm ci`. The fork is development-only. Keep the full audit at its existing severity threshold. npm identifies the fork separately, so maintainers must track upstream Picomatch advisories while the override is present. After a patched upstream version is available, remove the local dependency and override, regenerate the lockfile and verify the full audit, tests and Docker build.

## Media processing and encrypted files

Status: accepted.

Use one random AES-256-GCM key per original, preview and thumbnail. A tagged header and 256 KiB authenticated segments let the server verify and return only the bytes requested by a browser. Wrap file keys in SQLite and keep ciphertext on the data volume. Write and sync the files before publishing their rows in one transaction. A restart can reclaim encrypted files left outside that transaction.

Use Busboy (MIT) for bounded streaming multipart parsing and `sharp` (Apache-2.0, with LGPL-compatible libvips) for image derivatives. Some image and video readers need seekable input. A Python helper passes anonymous Linux memory files to ExifTool, FFmpeg and `sharp` so tools can seek without creating plaintext files on the data volume. Each tool process runs with Landlock, seccomp and resource limits. Uploads run one at a time to bound aggregate memory. Supported videos use H.264 or HEVC in MP4 or MOV, with an H.264/AAC derivative for browser playback.

Image originals preserve compressed data, orientation, capture timestamps, color profiles and allowlisted camera settings. Video originals preserve compressed picture and audio samples, creation time and display rotation. Opaque tags, metadata tracks and supplementary video messages can carry location, so the cleaning step removes those carriers. This can discard some non-location camera or video metadata. Downloaded originals are the cleaned originals.

## Reminder email and durable delivery claims

Status: accepted.

Use Nodemailer (MIT-0) for authenticated SMTP, certificate-verified TLS and plain-text MIME composition. Only the operator's configured relay receives connections, and its credentials come from a mounted secret file. Members opt in with an email address and time zone. A shared event can have several reminder offsets, but each delivery belongs to a single member and local event occurrence.

Keep both pending deliveries and completed or ambiguous claims in SQLCipher. SMTP acceptance and a local database update cannot be atomic. Saving the claim before submission prevents a duplicate after a crash. This can omit a reminder when the process dies after claiming it or the relay disconnects after receiving the message. Retry explicit temporary rejections and known pre-submission failures. Keep claim records until the event or member is deleted so changing the same occurrence's settings cannot send the same reminder twice.

## Timeline anchors and pagination

Status: accepted.

Use the shared event's original local start date for its timeline position, including for occasions. This gives each event one entry in the story while the calendar expands recurring dates. Order ties by event ID and preserve the original precision in the visible date label. Use the existing categories for filtering.

Fetch 24 events at a time and use the indexed date and ID pair as the boundary in either direction. This bounds the rendered entries per request, works without JavaScript and lets the link continue working if its anchor is deleted. A year can span multiple batches. Each event shows at most one thumbnail, so opening a timeline page keeps its media requests bounded.
