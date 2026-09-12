# LedgerIQ (working name)

A web-based financial admin platform for solo and micro-business owners, evolving from the original Expense Tracker. The destination is a double-entry ledger with bank feeds, invoicing, reports, and a grounded AI "Money Brief" that turns bookkeeping data into a specific next action. The roadmap, design decisions, and review history live in `docs/` and the ADRs in `docs/adr/`.

**Current state (Slice 1, PR d):** the app runs entirely on Postgres. Auth creates an organization per signup (owner membership, default chart of accounts); every route is organization-scoped and role-checked (`docs/api.md`), with a generated authz matrix covering all of them; transactions are journal entries in a **double-entry ledger** with database-enforced invariants (`docs/ledger.md`); the old Expense Tracker data has been migrated. The current pages still look like the tutorial app; the Transactions page, CSV import, Overview metrics, and the weekly AI brief are the next lanes (`docs/architecture.md`).

## Repository layout

```
ledgeriq/
├── apps/
│   ├── api/          # Express 5 + TypeScript API on Prisma 7 / Postgres
│   └── web/          # React 19 + Vite app
├── packages/
│   └── shared/       # Schemas, money and date helpers shared by api and web (scaffold)
├── docs/             # Setup, architecture, ledger design, ADRs
├── TODOS.md          # Deferred work with context
└── package.json      # npm workspaces + root scripts
```

## Running locally

**Prerequisites:** Node.js 20+ (tested on 24), npm 10+, PostgreSQL (local, Docker, or a free Neon/Aiven tier).

```bash
npm install                       # installs every workspace from the root
psql -U postgres -h localhost -f scripts/create-local-db.sql   # once; or `docker compose up -d`
cp apps/api/.env.example apps/api/.env
# fill in DATABASE_URL, TEST_DATABASE_URL, JWT_SECRET (see docs/setup.md)
npm run setup                     # migrate + seed the demo organization
npm run dev                       # starts api (tsx watch) and web (Vite) together
```

The web app runs on `http://localhost:5173` and proxies `/api` to the API on `http://localhost:8000`, so there is one origin and no CORS in development. Full walkthrough and troubleshooting: `docs/setup.md`.

Other root scripts: `npm run dev:api`, `npm run dev:web`, `npm run build` (web), `npm run lint`, `npm run typecheck`, `npm run test` (needs `TEST_DATABASE_URL`), `npm run db:migrate`, `npm run db:seed`, `npm run ci`. Demo login after `npm run setup`: `demo@ledgeriq.local` / `demo-ledgeriq`.

## Features (today)

- Email/password auth with JWT; signup creates your organization and chart of accounts; roles owner / admin / bookkeeper / accountant / viewer
- Dashboard from the ledger: totals, cash on hand, uncategorized count, 30/60-day windows in your timezone, recent transactions
- Money in / money out: add, edit (manual entries are corrected by reversal), reverse, split across categories, Excel export (the Download buttons work now)
- Every read and write is organization-scoped; foreign ids are 404s; auth responses never include the password hash
- Request ids on every response and a structured error envelope (`{ message, error: { type, code, param?, requestId } }`)

## API

`/api/v1`: `auth/*`, `organizations`, `accounts`, `dashboard`, `transactions` (cursor-paginated, filterable, exportable). Full table with bodies, roles, and error codes: `docs/api.md`. Amounts are integer minor units; dates are `YYYY-MM-DD` in the organization's timezone.

## Where this is going

1. **Slice 1 (foundations done):** Transactions page, CSV import and Plaid sandbox, deterministic metrics on the Overview, and a weekly grounded Money Brief are the remaining lanes.
2. **Slice 2:** invoicing, orders/COGS/payout matching for product brands, P&L and cash-flow reports, Plaid production.
3. **Phase 2+:** sales tax and nexus tracking, reconciliation, bills/AP, accountant access, payroll sync, AI decision support.

See `docs/architecture.md` for the target system and `docs/adr/` for why each big decision was made. Contributing: `CONTRIBUTING.md`.

## License

Personal and educational use.
