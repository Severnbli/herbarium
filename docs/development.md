# Development

Read [AGENTS.md](../AGENTS.md) before changing the project. It contains the authoritative commands, conventions, security rules and Git workflow.

## Local setup

Use Node.js 24 or newer and install the locked dependencies:

```bash
npm ci
cp .env.example .env
```

Follow `.env.example` to configure a local data directory and a development master key. Generate a fresh key with `openssl rand -base64 32`; keep it in the ignored `.env` file or a secret file. Never use production keys or real member data for development. Start the app with `npm run dev`.

First-run setup requires the code stored in `setup-code` inside the configured data directory. The file is removed after the first owner is created. See [deployment.md](deployment.md#first-run-setup) for the setup flow.

The media pipeline and its tests use Python 3, ExifTool, FFmpeg 8 with `libx264`, ffprobe and libseccomp on Linux with Landlock ABI 3 or newer. The SMTP integration tests use OpenSSL to generate a temporary certificate and run a relay on localhost. On Ubuntu 26.04, install the development tools with `sudo apt-get install ffmpeg libimage-exiftool-perl libseccomp2 openssl python3`. The production image bundles its media tools.

## Verification

Before committing, run:

```bash
npm run check
npm run lint
npm run test
```

Run `npm run test:e2e` for browser-flow changes; see `playwright.config.ts` for production-build and test-server setup. Unit tests are colocated with source files. Use isolated temporary data and synthetic fixtures for security tests.

CI runs the browser suite with Playwright's Chromium headless shell and the shared libraries provided by its Ubuntu 26.04 runner.

For schema changes, run `npm run db:generate`, review the generated SQL and commit migrations alongside the schema. The app applies migrations on startup.

## v1.0 release review

The accessibility review covered public and authenticated screens with synthetic content in English, Belarusian and Russian, in both themes. It used Chromium, axe WCAG 2.2 AA checks, 320 CSS pixel reflow, keyboard checks for forms, navigation and the photo lightbox, and reduced-motion checks. Form control borders now meet 3:1 contrast against linen and paper in both themes. The map has a server-rendered event list and coordinate inputs. Members can add descriptions for their uploaded media. The player currently has no caption-track authoring or upload controls, so this review does not claim WCAG conformance for member-supplied videos.

The security review followed [the project requirements](../AGENTS.md#security) across sign-in and session handling, encryption, private media and map routes, input validation, HTTP headers, archive operations and deployment. The sign-in return-path check now rejects ambiguous path separators and raw line breaks. Unexpected request failures log only a reference ID and a fixed message, leaving driver and tool error details out of logs. The installed app caches successful public immutable build assets fetched without credentials. Both the full and production-only lockfile audits reported zero advisories after the development-tool updates.

## Translations

Edit `messages/en.json`, `messages/be.json` and `messages/ru.json` together, and expose new keys through `src/lib/i18n/catalog.ts`. Parameters use `{name}`; plural variants declare a `plural` selector and supply the locale's CLDR categories with a catchall. Translation catalogs contain data, not executable TypeScript.

`npm run i18n:compile` generates typed message functions. Development, production builds and unit tests compile through the Vite plugin; `npm run check` compiles before checking types. Generated output and inlang caches are ignored. The translation plugin is installed from the lockfile and loaded locally, so compilation needs no translation CDN and the app makes no translation requests at runtime.

Use `formatDateOnly` for calendar dates, `formatDateTime` with an explicit IANA zone for instants, and `weekStartsOn` for calendar layouts.

## Documentation workflow

- Update [ROADMAP.md](ROADMAP.md) when a delivery item is completed.
- Record significant choices and tradeoffs in [decisions.md](decisions.md).
- Update [architecture.md](architecture.md) when module boundaries or data flow change.
- Update operational docs when configuration, deployment or key handling changes.
- Keep shared agent guidance in `AGENTS.md`; retain `CLAUDE.md` as a secondary import.

Open questions belong in the roadmap until resolved. Move their outcome into the decision log when the choice affects future work.

## Account and navigation

Use **Account** in the masthead to change language or appearance, manage security settings, or sign out. Language follows the member across devices. Appearance follows the browser's saved preference.

## Invitations

As an owner, open **Members**, enter an optional label, and choose **Create an invite link**. The new link and expiry appear below the form. Copy the link using the button or select the link text. The invitation list keeps the label and status for later management.

## Events

Open `/events` after signing in. All members can create and edit moments, plans and occasions, filter by kind and local start year, and delete an event after confirming their own password. Forms work without JavaScript. Date-only input formats are `YYYY-MM-DD`, `YYYY-MM` and `YYYY` for day/month/year precision. Timed input uses `YYYY-MM-DDTHH:mm` and an explicit IANA time zone. Repeated DST clock times require independent earlier/later choices for start and end; nonexistent clock times are rejected. The event's local start year determines its list filter even if the stored UTC instant falls in another year.

Unit tests cover date precision, DST gaps/folds, validation, sanitized notes, encrypted storage, pagination, plan transitions and independent route authentication checks. Browser tests exercise shared editing and password-confirmed deletion without JavaScript, local-year filters, blocked early completion, and mobile event pages in all three locales and both themes.

Select **New plan** to save a title with **No date yet**, or choose this date type while editing a plan. Find it through the Home link or open **Filters** in Events. On the detail page, use **Set date** or **Change date** to update its schedule and **Add place** or **Change place** to update its location.

For an occasion, use day precision and open **For occasions** to set the repeat schedule. Anniversaries and birthdays repeat yearly and show the anniversary number or age. For a general occasion, set **Repeat every** and select days, weeks, months or years. The occasion detail shows the localized schedule and upcoming dates.

## Memories

The **Memories** gallery shows photos and videos under clickable event headings, with a **Memories without an event** section for unlinked files. The gallery and lightbox show captions when available. Choose **Open details** to find the original filename.

Choose **Add photos and videos** from an event, an album, or **Memories**. Select photos and videos together and follow each file's progress. Retry individual failures while the upload page is open. **Upload one file** is also available and works without JavaScript. Supported files are JPEG, PNG, HEIC and H.264 or HEVC videos in MP4 or MOV. Members can edit alt text and captions, download cleaned originals and organize memories in multiple albums. Open **Change event link** on a memory's page to attach, move, or detach it. With JavaScript enabled, the gallery opens a lightbox with Previous and Next buttons, left and right arrow keys, and Escape to close. The same links open memory pages without JavaScript.

The media integration tests use synthetic JPEG, PNG, HEIC, MP4 and MOV files. They check compressed image and media samples, location stripping, authenticated downloads, corrupted files and size limits. Playwright covers event attachments, coordinate consent, albums, keyboard navigation and video range responses.

## Calendar

Open **Calendar** to switch between month, week and day views. Use **Jump to date** to choose a specific day. On narrow screens, the month and week are displayed as stacked days. Use the plus button on a date to prefill a new event. Past dates default to moments and today or future dates default to plans. The kind can still be changed on the event form.

## Reminders

Open an event with day precision, expand **Reminders**, and choose the reminder times. Members use **Calendar and email preferences** under **Account** to set their time zone and opt in with their own email address. All-day reminders are scheduled relative to 09:00 in that zone. Timed events use the time zone saved on the event. An offset of one day is 24 elapsed hours, including across DST changes.

Tests cover all-day and timed schedules across DST, durable claims and retries across database reopen, opt-out and event changes, and successful SMTP delivery and failure handling against a local test relay. See the [deployment guide](deployment.md#reminder-email) to configure mail for an instance.

## Timeline

Open **Timeline** to browse the shared story by year. Use the kind and category filters to narrow the entries, and **Older events** or **Newer events** to move through the results. Choose an event title to open its details or a thumbnail to open the attached memory.

Tests cover cursor boundaries with events on the same date, deleted anchors, combined filters and route authentication. Playwright checks navigation without JavaScript, mobile layout, reduced motion and authenticated thumbnails.

## Maps

Open **Map** to filter pinned events by kind, local start year and category. Saved places can be added, edited and deleted from the map. Events can use a saved place or a new location for each stop. The list beside the map links to the same events and works without JavaScript. On a create or edit form, expand **Location on the map** to search for a place, paste a latitude and longitude pair, or set and drag a pin. The two coordinate fields also work without JavaScript. On an existing event, attach a photo to review its GPS suggestion before saving the point.

Playwright installs a small [Belarus tileset fixture](../tests/fixtures/maps/README.md) and blocks outbound HTTP requests during the map flow. It checks authenticated ranges, glyph and sprite delivery, pin editing, event previews and keyboard access to the list. See the [deployment guide](deployment.md#offline-maps) to install a larger map for development.

To refresh place search, download the current `BY.zip`, `cities5000.zip` and `alternateNamesV2.zip` exports from [GeoNames](https://download.geonames.org/export/dump/) into one directory. Run `python3 scripts/build-gazetteer.py <source-dir>` from the repository root with a Python build that includes SQLite FTS5. Update the snapshot date and hashes in [the asset notice](../map-assets/README.md), then run the map tests. The build and runtime use the checked-in SQLite file.

## Dashboard

Open **Home** after signing in. **Coming up** counts down to event starts in the next 30 days, including today. Set the time zone under **Account** to change the local day and timed-event labels. Create a yearly occasion of type **Anniversary** with its original date to populate the anniversary highlight and time-together count. **On this day** uses exact original dates from previous years. **Recent memories** shows the latest uploads, including newly added photos with old capture dates.

Tests cover member time zones, elapsed starts, approximate dates, anniversary selection, leap days, historical matching and upload order. Playwright checks the home page with JavaScript disabled and follows the event and memory links.

## Portable archives

The archive integration test streams shared content from one encrypted instance, rejects a damaged ZIP and imports a valid ZIP into another instance with a different key. It verifies references, audit entries and encrypted media. The restore CLI is built alongside the application. See the [deployment guide](deployment.md#restore-a-portable-zip) for commands.

## Bulk media import

Choose **Import photos and videos** from **Memories**. Select multiple files from a gallery or use the folder picker. Upload progress is shown for the queue and the active file. You can pause and resume the queue, or return to the import and select the same files to skip completed transfers. An interrupted file uploads from the beginning. Each upload is subject to the usual limits. One open import can record up to 500 files.

The review groups photos and videos by capture date. Give a group a title and choose to create a moment, an album or both. With an unknown capture date, you can create an album. Review a photo location before optionally including it in a new moment. Finishing the import closes the queue and leaves any ungrouped files in **Memories**.

Playwright interrupts a bulk upload, resumes it after reload, verifies private queue access, checks duplicate detection against raw photo bytes and confirms the group with explicit coordinate consent. Unit tests check atomic grouping and session-bound location offers.
