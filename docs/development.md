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

## Verification

Before committing, run:

```bash
npm run check
npm run lint
npm run test
```

Run `npm run test:e2e` for browser-flow changes; see `playwright.config.ts` for production-build and test-server setup. Unit tests are colocated with source files. Use isolated temporary data and synthetic fixtures for security tests.

For schema changes, run `npm run db:generate`, review the generated SQL and commit migrations alongside the schema. The app applies migrations on startup.

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

## Events

Open `/events` after signing in. All members can create and edit moments and plans, filter by kind and local start year, and delete an event after confirming their own password. Forms work without JavaScript. Date-only input formats are `YYYY-MM-DD`, `YYYY-MM` and `YYYY` for day/month/year precision. Timed input uses `YYYY-MM-DDTHH:mm` and an explicit IANA time zone. Repeated DST clock times require independent earlier/later choices for start and end; nonexistent clock times are rejected. The event's local start year determines its list filter even if the stored UTC instant falls in another year.

Unit tests cover date precision, DST gaps/folds, validation, sanitized notes, encrypted storage, pagination, plan transitions and independent route authentication checks. Browser tests exercise shared editing and password-confirmed deletion without JavaScript, local-year filters, blocked early completion, and mobile event pages in all three locales and both themes.
