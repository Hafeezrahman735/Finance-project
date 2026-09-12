# Local setup

Target: clone to running app in under 5 minutes. Time yourself; if it takes longer, open an issue with the step that stalled.

## 1. Prerequisites

- Node.js 20 or newer (`node --version`), npm 10 or newer.
- A MongoDB connection string. A free MongoDB Atlas cluster works (Database Access: create a user; Network Access: allow your IP). Postgres via Docker replaces this in a later PR; this page will change then.
- Windows, macOS, and Linux are all supported. On Windows, Git Bash or PowerShell both work; the repo pins LF line endings via `.gitattributes`.

## 2. Install

```bash
git clone https://github.com/Hafeezrahman735/Finance-project.git ledgeriq
cd ledgeriq
npm install
```

`npm install` at the root installs every workspace (`apps/api`, `apps/web`, `packages/shared`) into a single `node_modules` and a single `package-lock.json`. Do not run `npm install` inside `apps/*`.

## 3. Configure the API

```bash
cp apps/api/.env.example apps/api/.env
```

| Variable | Required | Default | Notes |
|---|---|---|---|
| `MONGO_URL` | yes | — | Atlas connection string, e.g. `mongodb+srv://user:pass@cluster.mongodb.net/ledgeriq` |
| `JWT_SECRET` | yes | — | Any long random string (`openssl rand -hex 32`) |
| `PORT` | no | `8000` | The Vite dev server proxies `/api` to `http://localhost:8000` (`apps/web/vite.config.js`), so the app is same-origin in development. Change both if you change one. |
| `CLIENT_URL` | no | none | CORS allowlist for a separately hosted web app only. With the proxy, leave unset. |
| `LOG_LEVEL` | no | `info` | pino level. |
| `JWT_EXPIRES_IN` | no | `1h` | Access token lifetime. |

The API validates its configuration at boot and prints one line per problem, e.g. `Config error: MONGO_URL is missing. Copy .env.example to .env and set it (docs/setup.md#3-configure-the-api).`

## 4. Run

```bash
npm run dev
```

This starts both processes with prefixed output:
- `api` — `tsx watch apps/api/src/server.ts`, prints `MongoDB connected` and `server running on port 8000`
- `web` — Vite dev server, prints a `http://localhost:5173` URL

Open the URL, sign up, add an income and an expense, and the dashboard should show totals and charts. `http://localhost:5173/healthz` returns `{"ok":true}` through the proxy.

Run one side only with `npm run dev:api` or `npm run dev:web`.

## 5. Verify

- `npm run ci` runs lint, typecheck, test, and build in the same order as GitHub Actions.
- `npm run test` runs the API suite (Vitest + Supertest) against an in-memory MongoDB (`mongodb-memory-server`). The first run downloads a ~600 MB mongod binary into `~/.cache/mongodb-binaries` and can take a few minutes; later runs take about 30 seconds. No Atlas cluster is needed for tests.
- `npm run lint` and `npm run typecheck` must be clean; `apps/web` has 5 `react-hooks/exhaustive-deps` warnings that are addressed when those pages are rewritten.

## Troubleshooting

- **`Error connecting to MongoDB` then exit** — `MONGO_URL` is missing or the Atlas IP allowlist does not include you.
- **Dashboard blank, console shows `504` or `ECONNREFUSED` for `/api/...`** — the API is not running on 8000; check the `api` process output and `PORT` in `apps/api/.env`.
- **Error responses** carry `{ message, error: { type, code, param?, requestId } }` and an `X-Request-Id` header; the same id appears in the API log line for that request.
- **`401` immediately after login** — `JWT_SECRET` changed between issuing and verifying; log out and in again.
- **Windows: `'tsx' is not recognized`** — run scripts through npm (`npm run dev:api`), not by calling binaries directly; the root install puts them under the root `node_modules/.bin`.

## What changes next

The Prisma/Postgres PR (c) replaces `MONGO_URL` with `DATABASE_URL`, adds `docker compose up -d`, `npm run setup` (migrate + seed a demo organization), and a tiered config where Plaid, Anthropic, and Resend keys are optional and their features switch off when absent.
