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

## Documentation workflow

- Update [ROADMAP.md](ROADMAP.md) when a delivery item is completed.
- Record significant choices and tradeoffs in [decisions.md](decisions.md).
- Update [architecture.md](architecture.md) when module boundaries or data flow change.
- Update operational docs when configuration, deployment or key handling changes.
- Keep shared agent guidance in `AGENTS.md`; retain `CLAUDE.md` as a secondary import.

Open questions belong in the roadmap until resolved. Move their outcome into the decision log when the choice affects future work.
