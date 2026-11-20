# Architecture

## Current implementation

Herbarium is a SvelteKit application using Svelte 5 runes, strict TypeScript and `adapter-node`. One instance represents one shared circle. The v1.0 roadmap covers the security foundation, three locales, moments, plans, recurring occasions, memories, calendar views, reminders, the timeline, maps, the dashboard, data ownership operations and browser installation. [Roadmap](ROADMAP.md)

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

After authentication, the locale hook uses the member's saved `user.locale`, or negotiates `Accept-Language` when no preference exists. The language form under Account preferences posts to the authenticated account action, validates a strict locale allowlist and saves only the current member's preference. A redirect renders the new language without JavaScript. Existing sessions on other devices use the saved preference on their next request. Public and pending second-factor pages use browser-language detection.

Date-only formatting fixes the time zone to UTC to preserve the day; timed formatting requires an explicit event time zone. Week starts follow the supported locales: Monday for Belarusian and Russian, Sunday for English.

## Planned boundaries

Events share one encrypted table with `moment`, `plan` and `occasion` kinds. The event services, schemas, date/notes modules and server-first screens are implemented. Date-only values stay `YYYY-MM-DD` strings, normalized to the first day for month/year precision. Timed events store UTC instants and an IANA time zone, plus the local start date for sorting and year filters. An undated plan has no date or sort key. Year filters, calendar, timeline and upcoming views use dated events.

The deployment remains one Node application and one data volume. Runtime assets are self-hosted; user data never goes to third-party APIs. Record boundary changes in [decisions.md](decisions.md).

## Design system

`src/lib/design.css` defines semantic color tokens, typography, controls and the accessibility baseline. Light linen and dark Kupalle themes follow the operating system. The appearance selector is available under Account preferences and on public sign-in screens. It stores an optional device preference in localStorage, separate from the account language. A small same-origin script applies the allowlisted theme before first paint, without inline script or a CSP exception. With JavaScript disabled, system appearance and server forms still work.

DejaVu Serif and Sans are bundled as WOFF2 build assets and cover Belarusian і and ў. The lossless conversion preserves the original glyphs and reduces the two fonts from 1,140,380 to 405,484 bytes before HTTP compression. The redistribution license is served from `/fonts/LICENSE.txt`. Shared components provide buttons, labelled inputs (`Field`), textareas, selects, precision-aware native date fields, modal dialogs, persistent dismissible status messages and herbarium cards. Decorative inline SVG ornaments are hidden from assistive technology. The app shell includes a skip link, current-page navigation and responsive form layouts. Account settings and sign-out live on the Account page.

DatePicker submits the selected precision separately from its date value (day: YYYY-MM-DD, month: YYYY-MM, year: YYYY). Changing precision clears the previous value. Feature actions must validate and normalize these fields on the server before storing them; this visual component does not define event storage.

## Installed web app

The public web manifest supplies a standalone launch URL, botanical icons and a linen background for the browser-generated splash screen. The production service worker lazily caches exact URLs from the immutable client build, fetches them without credentials and discards earlier Herbarium caches on activation. Page navigation, form submissions, data requests and media always go to the server. Installed Herbarium needs a connection to its instance.

## Event dates and notes

`src/lib/domain/event-date.ts` uses the ISC-licensed Temporal polyfill to validate calendar dates, convert local clock times to instants, render precision and determine whether an interval has elapsed. Nonexistent DST times are rejected. Repeated local times require explicit earlier/later choices, independently for start and end. Date-only end dates are inclusive; plan completion uses the next UTC day, month or year boundary so a partially elapsed date-only period cannot be completed early.

`src/lib/server/events/schemas.ts` strictly validates fields, bounded notes, paired coordinates, chronological ends and list filters. `notes.ts` renders a small Markdown subset with markdown-it (raw HTML and images disabled), then sanitizes with sanitize-html. Only paragraphs, bold, italic, lists, links and line breaks survive. Links use allowlisted schemes and forced `rel="noopener noreferrer"`. Both dependencies are MIT-licensed and server-only.

`src/lib/server/events/events.ts` provides validated create/update/delete operations, author-preserving plan completion and paginated list queries. Lists filter by the local start year and kind and return 30 records per page, ordered by local start date and random identifier. SQL is built through Drizzle with bound parameters. Authenticated routes under `/events` provide a paginated list, kind/year filters, a create form, detail pages and edit forms. Every load and action checks its session independently of the hook. Members can edit all events; the author stays unchanged. Deleting an event requires rate-limited password confirmation and writes a content-free audit event in the same transaction.

Event forms accept bounded text dates in the displayed formats, so selecting a different precision or timed mode works without client JavaScript. Failed submissions return known, bounded field values and field identifiers; password values are never returned. Kind, category and date/clock options are fully translated in all three locales. Detail pages render the server-sanitized notes HTML as the only user-content `{@html}` exception.

## Occasions and recurrence

Occasions share the event table and store a single RRULE and occasion type alongside their original event dates. `listOccurrences` expands starts over an inclusive local-date range of at most 367 dates. Occurrence rows are computed on demand. The event list still shows one row per original event and filters by its original local start year. Event details show the recurrence summary and up to five occurrences in the coming year.

The server accepts yearly and monthly presets, and custom daily, weekly, monthly or yearly intervals from 1 to 99. Anniversaries and birthdays use the yearly preset and count the years elapsed since the original date. Yearly February 29 occasions fall on February 28 in non-leap years. Monthly rules skip months without the original day. Timed occurrences retain local wall time and elapsed duration. DST gaps are skipped, future repeated clock times use the earlier instant and the original occurrence retains its saved instant.

## Media storage

The encrypted database stores memory metadata and the wrapped key for each original, preview and thumbnail. The media directory holds ciphertext files named by random IDs. [`/media/[id]/[variant]`](../src/routes/media/%5Bid%5D/%5Bvariant%5D/+server.ts) requires a fully authenticated member session and serves private `GET` and `HEAD` responses with a fixed media type and filename disposition. `GET` supports single byte ranges. The server authenticates the header and each requested segment and aborts delivery if a segment fails verification. See [key management](key-management.md) for the file format.

The streaming multipart parser bounds each file and the entire request. A Linux helper holds media in anonymous memory files and identifies JPEG, PNG, HEIC, MP4 and MOV from their bytes. Landlock and seccomp restrict the image and video tools, which receive media through inherited descriptors and run under time, memory, output and pixel limits. `sharp` generates JPEG image derivatives. FFmpeg creates a JPEG video poster and an H.264/AAC playback derivative. ExifTool cleans image originals without changing compressed image data. FFmpeg copies compressed audio and video into a fresh container, retaining capture time and display rotation while removing metadata tracks and supplementary video messages that can carry location. The database transaction publishes a memory only after its encrypted assets are durable. On restart the server removes encrypted files left without a database row.

## Memories and albums

The Memories gallery groups files by event, with a separate section for files without an event. SQLite orders the groups by their newest memory before applying pagination, so each event occupies consecutive positions. Within each group the gallery uses capture dates, falling back to the UTC upload date. The event page lists its attachments and links to a filtered gallery for longer collections. The upload form can offer a photo's location for an event that has no coordinates. The suggestion is sealed, expires after 30 minutes and is bound to the uploading session and memory. Accepting it writes the coordinates directly to the event if its location is still unset and the memory still belongs to the same event.

A memory can be uploaded on its own or attached to one event, and it can belong to several albums. The everyday upload queue uses the same per-file streaming pipeline as single uploads. Each file has a receipt that commits with the memory and its destination. The shared gallery supports attaching an existing memory to an event, moving it, and detaching it without modifying album memberships. Events and albums have independent lifecycles. Deleting an event detaches its files. Deleting an album removes its memberships. Deleting a memory removes every membership and discards its wrapped keys and files. Memory and album deletion require password confirmation and create a content-free audit entry.

## Calendar

The authenticated calendar uses inclusive local-date grids and expands occasions over the visible period. Timed events appear on the dates in their saved event time zone. The calendar shows each event across its span, including the latest ongoing occurrence that began before the grid. Approximate dates retain their precision label. Birthdays and anniversaries show the localized count for each occurrence. Today uses the member’s account time zone, which defaults to Europe/Minsk. Navigation and quick create use validated date links and forms rendered on the server.

## Reminder scheduling

Members can set shared reminder offsets on events with day precision. Each member controls their own email opt-in, address and time zone. A timed reminder uses the event's saved start instant, or the expanded start of a recurring occurrence. All-day reminders use 09:00 in the recipient's time zone. Offsets are elapsed minutes counted back from that start.

When SMTP is configured, one scheduler in the Node process polls the encrypted database once a minute. It queues due times up to 14 days ahead and recovers eligible reminders that became due while the server was stopped. It rechecks the current event, offset, active membership and preference before claiming a delivery. Queued reminders remain eligible for up to 24 hours after the due time. Each event, local occurrence date, member and offset identifies one delivery. The scheduler commits the claim before contacting SMTP. Temporary explicit rejections and known pre-send failures retry with backoff. An interrupted or ambiguous submission keeps its claim so that the next process cannot submit the same reminder again.

The SMTP message uses the member's saved language or the request locale recorded with their preferences. Its plain-text body contains the event title, formatted date and an authenticated event URL. The relay connection requires certificate-verified TLS. SMTP settings and credentials stay out of browser data, delivery rows and logs.

## Timeline

The authenticated `/timeline` load returns up to 24 events, newest local start date first, grouped by year. Each occasion appears once at its original date. Date labels use the stored precision and time zone. Filters use the shared event kinds and categories. Normalized dates position approximate entries in the sequence while their labels retain the original month or year precision.

Newer and older links request one batch at a time using a validated local start date and event ID as the boundary. The query reuses the event date and ID index. For each entry, the attachment index selects the most recent attached memory by capture date, with upload date as the fallback. Page data is limited to event summaries and the selected preview identifiers and labels. The browser lazy-loads each thumbnail from the existing authenticated media route. Navigation and filtering use links and a GET form. CSS animates the stem and branches when the browser allows motion.

## Map of memories

The authenticated `/map` load selects events with both coordinates from SQLCipher and optionally filters by kind, original local start year and category. The list is rendered on the server and each event links to its detail page. The interactive map clusters GeoJSON points in a same-origin MapLibre worker. A popup uses the same indexed attachment lookup as the timeline and fetches its thumbnail only when opened. Coordinates stay in the encrypted event row and authenticated page data. Web Mercator clamps points to its latitude limit for display; coordinate fields and detail text keep the stored values.

MapLibre and its stylesheet load when an interactive map mounts. Herbarium uses the full Protomaps basemap style for v4 vector tiles with Linen and Kupalle colors and labels in the member's language where names are present. The asset route requires a full session for requests for the PMTiles archive, glyphs, basemap sprites and marker sprites. It serves a fixed allowlist with single byte ranges and version validators. The only operator-supplied file is `basemap.pmtiles` at the root of the data directory. An instance without the archive can still use place search, coordinate fields and event pins.

The place picker queries a bundled read-only SQLite gazetteer using bound FTS expressions built from name tokens. Search terms travel in the request body. GeoNames names and coordinates are public reference data in a separate database. Choosing a result fills the place and coordinate fields for the normal event save. Memory upload displays a photo GPS suggestion on a local map and retains the existing session-bound consent action.

## Dashboard

The authenticated root page shows up to six event starts within the next 30 calendar days and includes the current day. Each occasion contributes its first upcoming recurrence in the window, using the same recurrence expansion as the calendar. Timed events must still be upcoming by instant. The dashboard displays those instants and counts down in the member's account time zone. All-day events retain their calendar dates. Month and year precision keep their original labels and can appear while the start period is current or begins in the window.

The anniversary panel finds the next anniversary even beyond the upcoming window. Time together counts calendar days since the earliest anniversary that has started. On this day shows up to five day-precision moments and occasions by their original local month and day in previous years. The recent memories panel shows the last four uploads and fetches thumbnails through the authenticated media route. The server load checks for a full session and returns display data for these sections. The root page remains the default after sign-in, with existing return links to protected pages preserved.

The historical lookup seeks by month and day, then walks the event date and ID in reverse order. The recent-memory lookup walks the upload-date index and uses the existing unique index to find each original's media type. Galleries and event lists use thumbnails capped at 400 pixels on their longest side. Full memory views use a bounded preview. The MapLibre renderer and its worker load only on pages that mount an interactive map.

## Portable archives

Any signed-in member can confirm their password under **Account → Export shared data**. A POST streams a ZIP containing a versioned `herbarium.json` manifest and all cleaned originals. Manifest version 2 supports undated plans, and restore accepts existing version 1 manifests. The archive contains event coordinates and shared attribution, album memberships and event reminder offsets. The database snapshot is taken before streaming begins, and any original deleted during the download remains readable until the stream closes. The encrypted volume retains operational records and private account settings. An audit row records each export started.

An offline restore command validates the manifest, ZIP entry names, sizes, checksums and relationships. Media goes through the existing memory-only cleaning and encryption pipeline under the destination key. The CLI rebuilds derivatives and commits rows together after every file succeeds. Historical authors keep their display names and record IDs as inactive profiles. The destination owner creates new invitations for members who need access.

## Master key rotation

Startup can open the existing database using a previous key to rotate its SQLCipher key. The rotation transaction wraps each unchanged media data key under the new wrapping key and re-seals both TOTP columns. Until the database opens with the intended new key, a fingerprint in the encrypted database identifies the pending operation and prevents startup with the previous key alone. After verification the server finalizes the rotation and records the audit event together. The [operator procedure](key-management.md#rotating-the-master-key) describes secret file setup and backup retention.

## Bulk media import

Each member can keep one active import and upload up to 500 photos or videos to it. Files are sent one at a time through the same bounded multipart and memory-only cleaning pipeline as individual uploads. A random key in the encrypted database authenticates HMAC-SHA256 fingerprints of the original byte streams before cleaning. Bulk uploads skip a match against a saved memory. Individual uploads still allow another copy. Existing originals had their raw metadata removed, so duplicate detection applies to uploads recorded after the feature is installed.

Successful uploads and duplicate results commit receipts in the same transaction as their memory rows. The browser uses bounded Web Crypto reads to identify the same selection after reload. Its fingerprints travel in headers and the server stores only keyed receipt identifiers scoped to the member's active import. Completed files are skipped before transfer. Pause or resume works at the file boundary. The server writes only location-cleaned ciphertext to disk.

Uploaded memories are available in the gallery. Pending organization groups use exact capture dates and an undated bucket. Confirming a displayed group creates a moment, an album or both in one transaction. Members can create albums for undated files. The GPS offer is held on the page and expires after 30 minutes. It is bound to the uploading session and the selected memory. Only explicit consent writes that point to the new moment.
