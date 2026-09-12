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
| `PORT` | yes for local dev | `5000` | **Set to `8000`.** The web app calls `http://localhost:8000` (`apps/web/src/utils/apiPaths.js`). A mismatch shows up as a blank dashboard and CORS errors in the browser console. |
| `CLIENT_URL` | no | `*` | CORS origin allowlist. Leave unset locally. |

## 4. Run

```bash
npm run dev
```

This starts both processes with prefixed output:
- `api` — `nodemon apps/api/server.js`, prints `server running on port 8000` and `MongoDB connected`
- `web` — Vite dev server, prints a `http://localhost:5173` URL

Open the URL, sign up, add an income and an expense, and the dashboard should show totals and charts.

Run one side only with `npm run dev:api` or `npm run dev:web`.

## 5. Verify

- `npm run build` builds the web app (`apps/web/dist`).
- `npm run lint` runs ESLint in every workspace that defines it. As of PR (a) there are 8 pre-existing unused-import errors in `apps/web`; the TypeScript port clears them.
- `node --check apps/api/server.js` is the API's only check until the test suite lands.

## Troubleshooting

- **`Error connecting to MongoDB` then exit** — `MONGO_URL` is missing or the Atlas IP allowlist does not include you.
- **Dashboard blank, console shows `net::ERR_CONNECTION_REFUSED` on `:8000`** — `PORT` is not `8000` in `apps/api/.env`.
- **`401` immediately after login** — `JWT_SECRET` changed between issuing and verifying; log out and in again.
- **Windows: `'nodemon' is not recognized`** — run scripts through npm (`npm run dev:api`), not by calling binaries directly; the root install puts them under the root `node_modules/.bin`.

## What changes next

The TypeScript port (PR b) keeps this flow. The Prisma/Postgres PR (c) replaces `MONGO_URL` with `DATABASE_URL`, adds `docker compose up -d`, `npm run setup` (migrate + seed a demo organization), and a tiered config where Plaid, Anthropic, and Resend keys are optional and their features switch off when absent.
