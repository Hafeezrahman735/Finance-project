# Architecture

Two views: what runs today, and the target the roadmap builds toward. Decisions behind the target are recorded in `docs/adr/`.

## Today (Slice 1, PR a)

```
  apps/web (React 19 + Vite)                 apps/api (Express 5, CommonJS)
  ┌────────────────────────────┐   HTTP    ┌──────────────────────────────────┐   ┌──────────┐
  │ pages: Login, SignUp, Home │ ────────▶ │ routes ─▶ controllers ─▶ models  │──▶│ MongoDB  │
  │        Income, Expense     │  /api/v1  │ middleware/authMiddleware (JWT)  │   │ (Atlas)  │
  │ context/UserContext        │           │ models: User, Income, Expense    │   └──────────┘
  │ utils/axiosinstance (token,│           │ xlsx export (writes to disk)     │
  │        401 → /login)       │           └──────────────────────────────────┘
  └────────────────────────────┘
  packages/shared: scaffold only
```

Known defects carried from the tutorial codebase, fixed in the port rather than patched here: update/delete routes do not filter by owner (`apps/api/controllers/incomeController.js`, `expenseController.js`); amounts are floating `Number`; auth responses include the password hash; `{timestampes: true}` typo disables timestamps; Excel export writes to the server filesystem; the API base URL is hardcoded in the web app.

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
| (a) this PR | Workspaces, docs, ADRs, no behavior change |
| (b) | TypeScript port of `apps/api`, still on Mongo; lint clean; test harness |
| (c) | Prisma schema, ledger service, Mongo → Postgres migration script with dry run |
| (d) | Cut over to Postgres; remove Mongoose |
| then | auth + organizations · Transactions UI · CSV import · Plaid sandbox · metrics + Overview · weekly brief |

The full plan with review history: the owner's plan file referenced in `TODOS.md`.
