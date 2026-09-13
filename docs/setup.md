# Local setup

Target: clone to running app in under 5 minutes. Time yourself; if it takes longer, open an issue with the step that stalled.

## 1. Prerequisites

- Node.js 20 or newer (`node --version`), npm 10 or newer.
- PostgreSQL 15 or newer, reachable via a connection string (section 2). That is the only database.
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
| `MONGO_URL` | no | — | Only for the one-time `migrate:mongo` import of Expense Tracker data |
| `JWT_SECRET` | yes | — | Any long random string (`openssl rand -hex 32`) |
| `PORT` | no | `8000` | The Vite dev server proxies `/api` to `http://localhost:8000` (`apps/web/vite.config.js`), so the app is same-origin in development. Change both if you change one. |
| `CLIENT_URL` | no | none | CORS allowlist for a separately hosted web app only. With the proxy, leave unset. |
| `LOG_LEVEL` | no | `info` | pino level. |
| `JWT_EXPIRES_IN` | no | `15m` | Access token lifetime; the web app refreshes it silently through the cookie. |
| `REFRESH_TOKEN_DAYS` | no | `30` | How long a signed-in browser stays signed in without logging in again. |
| `APP_URL` | no | `http://localhost:5173` | Where emailed links point (`/reset-password`, `/verify-email`). Set to the web app's public URL in production. |
| `RESEND_API_KEY` | no | none | Sends verification and reset emails through [Resend](https://resend.com) (free tier: 3,000 emails/month, no card). **Without it, every email is printed to the API log with the link in it**, which is how local development works with zero vendor keys. |
| `ANTHROPIC_API_KEY` | no | none | Narrates the weekly brief with `claude-opus-5`. **Without it the brief is the deterministic summary** ("This week's numbers"), which is how zero-key development works. Get a key at https://console.anthropic.com (pay as you go; a weekly brief is a few cents). |
| `AI_PROVIDER` | no | `anthropic` if a key is set, else `off` | `anthropic` \| `recorded` (replay cassettes from `BRIEF_CASSETTE_DIR`, for CI) \| `off`. |
| `AI_MODEL` | no | `claude-opus-5` | Model id for the brief. |
| `BRIEF_RECORD` | no | `false` | With `anthropic`, also save each response as a cassette so `recorded` runs can replay it. |
| `PLAID_CLIENT_ID`, `PLAID_SECRET` | no | none | Bank feeds through [Plaid](https://dashboard.plaid.com) (sandbox is free, no card). **Without them "Connect a bank" uses the built-in fixture bank**: offline, deterministic, two accounts, 60 days of rows, and a second sync that posts a pending row and edits one amount. |
| `PLAID_ENV` | no | `sandbox` with keys, else `fixture` | `sandbox` \| `production` \| `fixture`. Production needs Plaid's approval (TODOS.md). |
| `TOKEN_ENCRYPTION_KEY` | in production with Plaid | derived from `JWT_SECRET` | 64 hex chars (`openssl rand -hex 32`); bank access tokens are AES-256-GCM sealed with it. See [Bank feeds](#bank-feeds). |
| `TOKEN_ENCRYPTION_KEY_PREVIOUS` | no | none | Comma-separated old keys during a rotation. |
| `AUTH_RATE_LIMIT` | no | `true` | Per-IP / per-email limits on `/auth/*` (see [Rate limits](#rate-limits)). Only tests turn it off. |
| `EMAIL_FROM` | no | `LedgerIQ <onboarding@resend.dev>` | Sender. Resend's `onboarding@resend.dev` only delivers to your own account email; verify a domain for real users. |

The API validates its configuration at boot and prints one line per problem, e.g. `Config error: MONGO_URL is missing. Copy .env.example to .env and set it (docs/setup.md#3-configure-the-api).`

## 5. Migrate and seed

```bash
npm run setup      # prisma migrate deploy + seed the demo organization
```

The seed creates "Sunny Side Studio" with 90 days of product-brand activity and prints the demo login (`demo@ledgeriq.local` / `demo-ledgeriq`). Re-running rebuilds it. Log in with it at `http://localhost:5173` after `npm run dev`.

Bringing your Expense Tracker data across: `npm run migrate:mongo -w @ledgeriq/api -- --dry-run` prints a per-user report without writing; drop `--dry-run` to commit. Details in `docs/ledger.md`.

## 6. Run

```bash
npm run dev
```

This starts both processes with prefixed output:
- `api` — `tsx watch apps/api/src/server.ts`, prints `Postgres connected` and `server running on port 8000`
- `web` — Vite dev server, prints a `http://localhost:5173` URL

Open the URL and log in as the demo user (or sign up: one screen creates your organization and chart of accounts). The Overview leads with a sentence about the last 30 days; Transactions shows the uncategorized queue first. Press `?` for keyboard shortcuts. `http://localhost:5173/healthz` returns `{"ok":true}` through the proxy.

Run one side only with `npm run dev:api` or `npm run dev:web`.

## 7. Verify

- `npm run ci` runs lint, typecheck, test, and build in the same order as GitHub Actions.
- `npm run test` runs the shared-package tests and the API suite against `TEST_DATABASE_URL` (migrations are applied automatically; suites skip with a warning if it is unset). Takes about a minute. Every route is covered by the generated authz matrix (`apps/api/test/authz.test.ts`).
- `npx prisma studio -w @ledgeriq/api` (or `npm run db:studio -w @ledgeriq/api`) opens a browser UI over the ledger tables.
- `npm run lint` and `npm run typecheck` must be clean; `apps/web` has 5 `react-hooks/exhaustive-deps` warnings that are addressed when those pages are rewritten.

## Troubleshooting

- **`Error connecting to MongoDB` then exit** — `MONGO_URL` is missing or the Atlas IP allowlist does not include you.
- **Dashboard blank, console shows `504` or `ECONNREFUSED` for `/api/...`** — the API is not running on 8000; check the `api` process output and `PORT` in `apps/api/.env`.
- **Error responses** carry `{ message, error: { type, code, param?, requestId } }` and an `X-Request-Id` header; the same id appears in the API log line for that request.
- **`401` immediately after login** — `JWT_SECRET` changed between issuing and verifying; log out and in again.
- **Signed out after a short while** — the refresh cookie is scoped to `/api/v1/auth` on the same origin. If the web app is hosted separately, set `CLIENT_URL` for CORS and serve both over HTTPS on the same site, or the browser drops the `SameSite=Strict` cookie.
- **Where did the verification / reset email go?** — with no `RESEND_API_KEY`, look in the API terminal for a `warn` line containing the link and open it in the browser.
- **`Config error: DATABASE_URL is missing`** — section 4; `npm run setup` needs it too.
- **`password authentication failed for user "ledgeriq"`** — the role was not created; run `scripts/create-local-db.sql` as a superuser (section 2A).
- **Windows: `'tsx' is not recognized`** — run scripts through npm (`npm run dev:api`), not by calling binaries directly; the root install puts them under the root `node_modules/.bin`.

## Importing a statement

Transactions → Import (or the Overview's first action). Add the bank account once, drop the CSV your bank exported, confirm the four column questions (the first three values of each column are shown as proof; if every day in the file is ≤ 12 you are asked whether dates are day-first), review the counts, import. Re-uploading the same file reports every row as a duplicate; tick a row to import it anyway. Rules created from the category picker ("Always categorize … this way") apply on the way in. Files up to 10 MB / 50,000 rows.

## What changes next

Done in Slice 1: the Transactions page, CSV import, sessions and recovery, the Overview metrics, and the weekly brief (`docs/ai-brief.md`), each with its vendor key optional. Remaining: Plaid sandbox (1.4b).

### Bank feeds

Import → "Connect a bank (beta)" (or Settings → Connected banks). With Plaid keys, Link opens; in the sandbox any bank accepts `user_good` / `pass_good`. Without keys the fixture bank connects immediately. Every connected account becomes a bank account with its own ledger account, exactly like a CSV import, and "Sync now" pulls new, changed, and removed rows: changed rows are reversed and re-posted with the category kept; removed rows are reversed; a pending row that posts under a new id inherits the category you gave the pending one. Rules apply on the way in. Webhooks are not wired yet (TODOS.md); use "Sync now" or run a periodic sync.

**Access tokens at rest.** Each connection's Plaid access token is stored AES-256-GCM encrypted under `TOKEN_ENCRYPTION_KEY`, tagged with the key's id. To rotate: set the new key as `TOKEN_ENCRYPTION_KEY`, move the old one to `TOKEN_ENCRYPTION_KEY_PREVIOUS`, deploy; rows re-encrypt the next time they are read (every sync). Drop the previous key once `SELECT count(*) FROM bank_connections WHERE key_id <> '<current id>'` is zero. Without any key, development derives one from `JWT_SECRET` and logs a warning; production with Plaid refuses to boot without a real key.

### Rate limits

Login: 10 per 15 minutes per IP+email. Register: 5 per hour per IP. Refresh: 60 per 15 minutes per IP. Forgot password: 5 per hour per IP+email. Reset password: 10 per hour per IP. Verify email: 20 per hour per IP. Resend verification: 3 per hour per user. Exceeding one returns `429` with `error.code = rate_limited_<route>` and `RateLimit-*` headers. Counters are in memory per API process (fine for one instance; move to a shared store when there are several). **Behind a reverse proxy or a platform load balancer (Railway, Render, Fly) set `TRUST_PROXY=1` so limits key on the client IP rather than the proxy's.**

### Before the first real user

1. `RESEND_API_KEY` with a verified sending domain, and `APP_URL` set to the public web URL — otherwise verification and reset links only exist in the server log and every user stays "unverified".
2. `NODE_ENV=production` (secure cookies; refuses `npm run db:seed`).
3. Decide the AI data-sharing policy before handing out `ANTHROPIC_API_KEY`; the brief stays off per organization until an owner opts in from Settings.

**Weekly brief run.** `npm run brief:weekly` (from the repo root: `npm run brief:weekly --workspace @ledgeriq/api`) generates this week's brief for every organization and emails verified owners. Schedule it for Monday morning with cron or Task Scheduler until the pg-boss worker lands; it is idempotent, so running it twice sends nothing twice.
