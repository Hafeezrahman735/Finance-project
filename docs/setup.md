# Local setup

Target: clone to running app in under 5 minutes. Time yourself; if it takes longer, open an issue with the step that stalled.

## 1. Prerequisites

- Node.js 20 or newer (`node --version`), npm 10 or newer.
- PostgreSQL 15 or newer, reachable via a connection string (section 2).
- Until the cut-over PR, also a MongoDB connection string: the current API still serves the old routes from Mongo while the ledger lives in Postgres. A free MongoDB Atlas cluster works.
- Windows, macOS, and Linux are all supported. On Windows, Git Bash or PowerShell both work; the repo pins LF line endings via `.gitattributes`.

## 2. Postgres

Any Postgres works; the app only needs `DATABASE_URL`. Pick one:

**A. Existing local install (recommended if you have one).** Create the app role and the dev + test databases once, as a superuser:

```bash
psql -U postgres -h localhost -f scripts/create-local-db.sql
```

That creates role `ledgeriq` (password `ledgeriq`, local only) and databases `ledgeriq` and `ledgeriq_test`. On Windows, install Postgres with `winget install PostgreSQL.PostgreSQL.17` if you do not have it; `psql` lands on your PATH.

**B. Docker.** `docker compose up -d` starts Postgres 18 with the same role and both databases.

**C. Hosted free tier.** Neon (recommended; scales to zero, branching for staging) or Aiven. Paste its connection string as `DATABASE_URL`; create a second database or branch for `TEST_DATABASE_URL`.

The test suite **truncates every table** in `TEST_DATABASE_URL` before each test. Never point it at a database you care about.

## 3. Install

```bash
git clone https://github.com/Hafeezrahman735/Finance-project.git ledgeriq
cd ledgeriq
npm install
```

`npm install` at the root installs every workspace (`apps/api`, `apps/web`, `packages/shared`) into a single `node_modules` and a single `package-lock.json`. Do not run `npm install` inside `apps/*`.

## 4. Configure the API

```bash
cp apps/api/.env.example apps/api/.env
```

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Postgres, e.g. `postgresql://ledgeriq:ledgeriq@localhost:5432/ledgeriq` |
| `TEST_DATABASE_URL` | for `npm run test` | — | A separate database; it is truncated by the tests |
| `MONGO_URL` | yes (until cut-over) | — | Atlas connection string, e.g. `mongodb+srv://user:pass@cluster.mongodb.net/ledgeriq` |
| `JWT_SECRET` | yes | — | Any long random string (`openssl rand -hex 32`) |
| `PORT` | no | `8000` | The Vite dev server proxies `/api` to `http://localhost:8000` (`apps/web/vite.config.js`), so the app is same-origin in development. Change both if you change one. |
| `CLIENT_URL` | no | none | CORS allowlist for a separately hosted web app only. With the proxy, leave unset. |
| `LOG_LEVEL` | no | `info` | pino level. |
| `JWT_EXPIRES_IN` | no | `1h` | Access token lifetime. |

The API validates its configuration at boot and prints one line per problem, e.g. `Config error: MONGO_URL is missing. Copy .env.example to .env and set it (docs/setup.md#3-configure-the-api).`

## 5. Migrate and seed

```bash
npm run setup      # prisma migrate deploy + seed the demo organization
```

The seed creates "Sunny Side Studio" with 90 days of product-brand activity and prints the demo login (`demo@ledgeriq.local` / `demo-ledgeriq`). Re-running rebuilds it. The demo login works once the cut-over PR moves auth to Postgres; today it exercises the ledger only.

Bringing your Expense Tracker data across: `npm run migrate:mongo -w @ledgeriq/api -- --dry-run` prints a per-user report without writing; drop `--dry-run` to commit. Details in `docs/ledger.md`.

## 6. Run

```bash
npm run dev
```

This starts both processes with prefixed output:
- `api` — `tsx watch apps/api/src/server.ts`, prints `MongoDB connected` and `server running on port 8000`
- `web` — Vite dev server, prints a `http://localhost:5173` URL

Open the URL, sign up, add an income and an expense, and the dashboard should show totals and charts. `http://localhost:5173/healthz` returns `{"ok":true}` through the proxy.

Run one side only with `npm run dev:api` or `npm run dev:web`.

## 7. Verify

- `npm run ci` runs lint, typecheck, test, and build in the same order as GitHub Actions.
- `npm run test` runs the shared-package tests and the API suite. Ledger tests use `TEST_DATABASE_URL` (migrations are applied automatically; suites skip with a warning if it is unset). Legacy route tests use an in-memory MongoDB: the first run downloads a ~600 MB mongod binary into `~/.cache/mongodb-binaries`; later runs take about a minute. No Atlas cluster is needed for tests.
- `npx prisma studio -w @ledgeriq/api` (or `npm run db:studio -w @ledgeriq/api`) opens a browser UI over the ledger tables.
- `npm run lint` and `npm run typecheck` must be clean; `apps/web` has 5 `react-hooks/exhaustive-deps` warnings that are addressed when those pages are rewritten.

## Troubleshooting

- **`Error connecting to MongoDB` then exit** — `MONGO_URL` is missing or the Atlas IP allowlist does not include you.
- **Dashboard blank, console shows `504` or `ECONNREFUSED` for `/api/...`** — the API is not running on 8000; check the `api` process output and `PORT` in `apps/api/.env`.
- **Error responses** carry `{ message, error: { type, code, param?, requestId } }` and an `X-Request-Id` header; the same id appears in the API log line for that request.
- **`401` immediately after login** — `JWT_SECRET` changed between issuing and verifying; log out and in again.
- **`Config error: DATABASE_URL is missing`** — section 4; `npm run setup` needs it too.
- **`password authentication failed for user "ledgeriq"`** — the role was not created; run `scripts/create-local-db.sql` as a superuser (section 2A).
- **Windows: `'tsx' is not recognized`** — run scripts through npm (`npm run dev:api`), not by calling binaries directly; the root install puts them under the root `node_modules/.bin`.

## What changes next

The cut-over PR (d) moves auth and the API routes onto Postgres and removes `MONGO_URL`; later Slice 1 lanes add Plaid, Anthropic, and Resend as optional keys whose features switch off when absent.
