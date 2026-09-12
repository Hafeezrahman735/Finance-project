# Architecture

Two views: what runs today, and the target the roadmap builds toward. Decisions behind the target are recorded in `docs/adr/`.

## Today (Slice 1, PR c)

```
  apps/web (React 19 + Vite)                      apps/api (Express 5, TypeScript, ESM)
  ┌────────────────────────────┐  /api (proxy)  ┌────────────────────────────────────────────────┐   ┌──────────┐
  │ pages: Login, SignUp, Home │ ─────────────▶ │ app.ts: requestLogger ─▶ cors ─▶ json           │──▶│ MongoDB  │
  │        Income, Expense     │                │   ─▶ routes.ts (validateBody ─▶ protect ─▶      │   │ (Atlas;  │
  │ context/UserContext        │                │        controllers/{auth,transactions,dashboard})│   │ in-memory│
  │ utils/axiosinstance (token,│                │   ─▶ notFoundHandler ─▶ errorHandler (envelope) │   │ in tests)│
  │        401 → /login)       │                │ config.ts (zod, tiered) · lib/{logger,errors,excel}│ └──────────┘
  └────────────────────────────┘                │ models: User (+DTO), Income, Expense             │
  packages/shared: money (minor units) + dates  └────────────────────────────────────────────────┘
                                                  services/ledger (post · reverse · recategorize ·   ┌──────────┐
                                                    lock · trial balance) ─▶ Prisma 7 ─▶            │ Postgres │
                                                  prisma/schema.prisma + migration with triggers    │ (ledger) │
                                                  fixtures/demoOrg · scripts/migrate-mongo-to-pg    └──────────┘
  test/: 43 API tests (Supertest on in-memory Mongo; ledger + property tests on TEST_DATABASE_URL) + 25 shared tests
```

The two databases coexist until PR (d): the legacy routes still read and write Mongo; the ledger, organizations, and audit log are in Postgres. `docs/ledger.md` explains the ledger rules.

Fixed in the port: owner filter on every update/delete; user DTOs (no password hash in any response); `timestamps` typo; Excel export streamed to the response with a formula-injection guard; API base URL from `VITE_API_URL` (empty by default, Vite proxies `/api`); the income delete route the web app calls but the old API never served. Still pending for the Prisma PR: float amounts (ADR 0002), wall-clock date windows, and the route naming conventions below.

## Target

```
                         ┌──────────────────────────────────────────────┐
                         │                 React (Vite)                  │
                         │  pages: Overview · Transactions · Import ·    │
                         │  Brief · Invoices · Orders · Reports · Settings│
                         └───────────────┬──────────────────────────────┘
                                         │ /api/v1 (same-site proxy; JWT access + httpOnly refresh)
                         ┌───────────────▼──────────────────────────────┐
                         │             Express (TypeScript)              │
                         │  middleware: auth · requireOrg · validate(zod)│
                         │  routes → controllers → services → repos      │
                         │  services/                                   │
                         │   ledger/     post · reverse · lock · balances│
                         │   banking/    csv import · plaid sync · rules │
                         │   invoicing/  invoices · payments · allocations│
                         │   orders/     orders · COGS · payout matching │
                         │   metrics/    daily snapshot per org          │
                         │   reports/    P&L (cash via allocations /     │
                         │               accrual) · cash flow · by channel│
                         │   ai/         brief · grounding validator ·   │
                         │               deterministic fallback          │
                         └───┬──────────────┬──────────────┬────────────┘
                             │              │              │
                   ┌─────────▼───┐  ┌───────▼──────┐  ┌────▼─────────────┐
                   │ Postgres    │  │ pg-boss jobs │  │ External          │
                   │ (Prisma)    │  │ feed.sync    │  │ Plaid · Stripe ·  │
                   │             │  │ brief.weekly │  │ Shopify · Resend ·│
                   │             │  │ overdue      │  │ Claude API        │
                   └─────────────┘  └──────────────┘  └──────────────────┘
```

### Principles

1. **Organization is the tenant.** Every business table has `organization_id`; repositories are org-scoped by type (`Scoped<T>`), so a controller cannot forget the filter. (ADR 0003)
2. **Double-entry underneath, plain language on top.** Every money movement is a balanced `JournalEntry`; the UI says money in / money out / transfer and never debit / credit. (ADR 0001, 0004)
3. **Integer minor units.** `BIGINT` cents in the database, JSON numbers below 2^53 on the wire, one `formatMoney` in `packages/shared`. (ADR 0002)
4. **Bank data is messy.** Imports create posted-but-unlocked entries against an `Uncategorized` account; processor deposits go to per-processor clearing accounts and are matched to batched payouts, not to individual sales. (ADR 0004)
5. **The AI narrates; it never computes or writes.** `services/metrics` produces tested SQL metrics; the brief cites metric IDs, is schema-validated and grounding-checked, and falls back to a deterministic summary. (ADR 0005)

### Conventions for `/api/v1`

- Plural nouns: `GET/POST /transactions`, `GET/PATCH/DELETE /transactions/:id`; actions as sub-resources: `POST /invoices/:id/send`, `POST /bank-connections/:id/sync`.
- `camelCase` JSON. Active organization via `X-Organization-Id`.
- Lists: `{ data: [], nextCursor: string | null }` with `?cursor=&limit=`.
- Mutations that a client may retry accept `Idempotency-Key`.
- Errors: `{ error: { type, code, message, param?, requestId, docsUrl? } }`; clients switch on `code`.
- Breaking changes bump to `/v2`; additive changes do not.

### Delivery sequence

Slice 1 lands in four revertible PRs, then feature lanes:

| PR / lane | Contents |
|---|---|
| (a) done | Workspaces, docs, ADRs, no behavior change |
| (b) done | TypeScript port of `apps/api`, still on Mongo; lint clean; Vitest + Supertest; GitHub Actions CI |
| (c) this PR | Prisma 7 schema + migration with DB-enforced ledger invariants, ledger service, shared money/date helpers, demo organization seed, Mongo → Postgres migration script with dry run and verification |
| (d) | Cut over to Postgres; remove Mongoose |
| then | auth + organizations · Transactions UI · CSV import · Plaid sandbox · metrics + Overview · weekly brief |

The full plan with review history: the owner's plan file referenced in `TODOS.md`.
