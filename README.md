# LedgerIQ (working name)

A web-based financial admin platform for solo and micro-business owners, evolving from the original Expense Tracker. The destination is a double-entry ledger with bank feeds, invoicing, reports, and a grounded AI "Money Brief" that turns bookkeeping data into a specific next action. The roadmap, design decisions, and review history live in `docs/` and the ADRs in `docs/adr/`.

**Current state (Slice 1, lane 1.3):** the app runs entirely on Postgres with a double-entry ledger underneath (`docs/ledger.md`), organization-scoped, role-checked routes (`docs/api.md`), and a new UI: an **Overview** that leads with one plain-language sentence about the last 30 days, and a **Transactions** page with an uncategorized-first list, a searchable category picker with splits, undo, bulk categorize, keyboard shortcuts, and a mobile layout. Design tokens (two typefaces, one accent, light theme, no cards/shadows/gradients) are lint-enforced. Next lanes: CSV import, Overview metrics, the weekly AI brief (`docs/architecture.md`).

## Repository layout

```
ledgeriq/
├── apps/
│   ├── api/          # Express 5 + TypeScript API on Prisma 7 / Postgres
│   └── web/          # React 19 + Vite + Tailwind 4 app (Headless UI, Recharts)
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
- Overview: headline sentence for the last 30 days (present in empty and partial states too), cash on hand, one primary action, 30-day in/out chart with a screen-reader table, recent activity
- Transactions: uncategorized rows first with an accent, filters (needs a category / all / in / out), search, cursor-paginated Load more, category picker (searchable, grouped, split mode), 8-second undo, bulk categorize with partial-failure retry, add-transaction sheet, xlsx export
- Keyboard: `n` add, `/` search, `j`/`k` move, `c` categorize, `x` select, `?` help; 44px targets, visible labels, focus rings, `aria-live` headline
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
