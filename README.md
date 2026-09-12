# LedgerIQ (working name)

A web-based financial admin platform for solo and micro-business owners, evolving from the original Expense Tracker. The destination is a double-entry ledger with bank feeds, invoicing, reports, and a grounded AI "Money Brief" that turns bookkeeping data into a specific next action. The roadmap, design decisions, and review history live in `docs/` and the ADRs in `docs/adr/`.

**Current state (Slice 1, PR c):** the API is TypeScript (Express 5, zod, pino, structured errors) and still serves the original routes from MongoDB, while the new **double-entry ledger** lives in Postgres via Prisma: organizations and memberships, a chart of accounts, journal entries with database-enforced invariants, sales channels and payouts for product brands, an audit log, a deterministic demo organization, and a verified migration of the old Mongo data. The cut-over PR (d) moves the routes onto the ledger; the AI layer follows (see `docs/architecture.md`, `docs/ledger.md`).

## Repository layout

```
ledgeriq/
├── apps/
│   ├── api/          # Express 5 + TypeScript API; Prisma/Postgres ledger + legacy Mongoose routes
│   └── web/          # React 19 + Vite app
├── packages/
│   └── shared/       # Schemas, money and date helpers shared by api and web (scaffold)
├── docs/             # Setup, architecture, ledger design, ADRs
├── TODOS.md          # Deferred work with context
└── package.json      # npm workspaces + root scripts
```

## Running locally

**Prerequisites:** Node.js 20+ (tested on 24), npm 10+, PostgreSQL (local, Docker, or a free Neon/Aiven tier), and until the cut-over PR a MongoDB connection string for the legacy routes.

```bash
npm install                       # installs every workspace from the root
psql -U postgres -h localhost -f scripts/create-local-db.sql   # once; or `docker compose up -d`
cp apps/api/.env.example apps/api/.env
# fill in DATABASE_URL, TEST_DATABASE_URL, MONGO_URL, JWT_SECRET (see docs/setup.md)
npm run setup                     # migrate + seed the demo organization
npm run dev                       # starts api (tsx watch) and web (Vite) together
```

The web app runs on `http://localhost:5173` and proxies `/api` to the API on `http://localhost:8000`, so there is one origin and no CORS in development. Full walkthrough and troubleshooting: `docs/setup.md`.

Other root scripts: `npm run dev:api`, `npm run dev:web`, `npm run build` (web), `npm run lint`, `npm run typecheck`, `npm run test` (Postgres test DB + in-memory Mongo), `npm run db:migrate`, `npm run db:seed`, `npm run ci`.

## Features (today)

- Email/password auth with JWT; protected routes; automatic redirect to login on 401
- Dashboard: totals, recent transactions, finance overview pie, 30-day expenses and 60-day income charts
- Income and expenses: add, edit, delete (with confirmation), emoji icon, Excel export endpoints
- Per-user data scoping on every read and write; auth responses never include the password hash
- Request ids on every response and a structured error envelope (`{ message, error: { type, code, param?, requestId } }`)

## API (today)

All routes are prefixed with `/api/v1`. Routes marked 🔒 require `Authorization: Bearer <token>`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Create an account |
| POST | `/auth/login` | Log in, receive a JWT |
| GET 🔒 | `/auth/getUser` | Current user |
| GET 🔒 | `/dashboard` | Totals, recent transactions, 30/60-day windows |
| POST 🔒 | `/income/addIncome` | Add income |
| GET 🔒 | `/income/getIncome` | List income |
| PATCH 🔒 | `/income/updateIncome/:id` | Update income |
| DELETE 🔒 | `/income/:id` (also `/income/delete/:id`) | Delete income |
| GET 🔒 | `/income/downloadexcel` | Income as `.xlsx` |
| POST 🔒 | `/expense/addExpense` | Add expense |
| GET 🔒 | `/expense/get` | List expenses |
| PATCH 🔒 | `/expense/updateExpense/:id` | Update expense |
| DELETE 🔒 | `/expense/:id` | Delete expense |
| GET 🔒 | `/expense/downloadExcel` | Expenses as `.xlsx` |

These route names are inherited from the original tutorial; the Prisma/Postgres PR replaces them with the REST conventions in `docs/architecture.md` (plural nouns, sub-resource actions, cursor pagination, a structured error envelope).

## Where this is going

1. **Slice 1:** TypeScript port, Postgres + Prisma double-entry ledger with organization tenancy, Transactions page, CSV import and Plaid sandbox, deterministic metrics on the Overview, and a weekly grounded Money Brief.
2. **Slice 2:** invoicing, orders/COGS/payout matching for product brands, P&L and cash-flow reports, Plaid production.
3. **Phase 2+:** sales tax and nexus tracking, reconciliation, bills/AP, accountant access, payroll sync, AI decision support.

See `docs/architecture.md` for the target system and `docs/adr/` for why each big decision was made. Contributing: `CONTRIBUTING.md`.

## License

Personal and educational use.
