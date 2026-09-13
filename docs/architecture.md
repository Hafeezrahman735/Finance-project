# Architecture

Two views: what runs today, and the target the roadmap builds toward. Decisions behind the target are recorded in `docs/adr/`.

## Today (Slice 1, lane 1.4a)

```
  apps/web (React 19 + Vite + Tailwind 4)             apps/api (Express 5, TypeScript, ESM)
  ┌──────────────────────────────────┐ /api (proxy) ┌────────────────────────────────────────────────┐
  │ pages: Login · SignUp ·          │ ───────────▶ │ app.ts: requestLogger ─▶ cors ─▶ json           │
  │        Overview · Transactions   │              │   ─▶ routes.ts (route TABLE, access per route)  │
  │ components/layout/AppShell       │              │        protect ─▶ requireOrg(role) ─▶ validate  │
  │ components/ui: Button · Field ·  │              │        ─▶ services/{auth,transactions,dashboard}│
  │   Sheet (dialog / bottom sheet)  │              │   ─▶ notFoundHandler ─▶ errorHandler (envelope) │
  │ components/transactions: Row ·   │              │ services/ledger: post · reverse · recategorize ·│  ┌──────────┐
  │   CategoryPicker (+split) ·      │              │   lock · trial balance ─▶ Prisma 7 (pg adapter) ┼─▶│ Postgres │
  │   AddTransactionForm             │              │ prisma/schema.prisma + migration with triggers  │  └──────────┘
  │ components/overview/InOutChart   │              │ services/banking: csv (parse·guess·map·dedupe) ·│
  │ pages/Import (3 steps) · Settings│              │   imports (upload·mapping·commit in batches) ·  │
  │                                  │              │   bankAccounts · services/rules (match·apply)   │
  │                                  │              │ fixtures/demoOrg · scripts/migrate-mongo-to-pg  │
  │ lib/api.js · lib/format.js       │              └────────────────────────────────────────────────┘
  │ index.css: @theme design tokens  │
  └──────────────────────────────────┘
  tests: 40 API (TEST_DATABASE_URL, incl. generated authz matrix) · 10 web (Testing Library) · 25 shared
```

MongoDB is gone from the runtime; `mongoose` remains a dev dependency for the one-time migration script. `docs/ledger.md` explains the ledger rules; `docs/api.md` lists every route.

### Design rules (lint-enforced by `apps/web/scripts/check-styles.mjs`)

Tokens live in `apps/web/src/index.css` (`@theme`): two typefaces (Fraunces for the headline sentence, Manrope for UI), one accent (`--color-accent`), light theme, 6px radius, 16px body. No `box-shadow` except focus rings, no gradients, no cards as layout, no system font stacks. Motion: a 300ms opacity tween on the headline, nothing else. Every overlay is `components/ui/Sheet` (dialog on desktop, bottom sheet under 640px); every input goes through `components/ui/Field` (visible label, 44px). Add `check-styles:allow` to a line to exempt it, with a reason.

Still pending for the Slice 1 lanes: Plaid sandbox (1.4b). Done: auth lane 1.1 (sessions, reset, verification), E1 (`services/metrics`, `GET /metrics`, the Overview's Numbers section), and E8 (the weekly Money Brief: `services/ai`, `GET /briefs/*`, the Brief page; contract in `docs/ai-brief.md`).

**Metrics (E1).** `services/metrics/metrics.ts` computes every number the brief may say: cash, money in/out, net cash burn, runway, gross and contribution margin, ROAS, effective fee rate (blended and per channel, with the prior 30 days), recurring charges (merchant slug, ≥ 3 occurrences at a monthly or weekly rhythm, delta vs the previous charge), and processor clearing balances with days since the last payout. Each metric has a stable id and a pre-formatted `display` string; the brief validator will only accept numbers that appear as one of these. Results are stored in `metrics_snapshots` per (org, day) with a fingerprint = `METRICS_VERSION` + entry count + latest entry update, so a read recomputes only when the ledger (or a metric definition) changed.

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
| (c) done | Prisma 7 schema + migration with DB-enforced ledger invariants, ledger service, shared money/date helpers, demo organization seed, Mongo → Postgres migration script with dry run and verification |
| (d) this PR | Auth on Postgres (org per signup), org/role middleware, REST routes from a route table, generated authz matrix, dashboard from the ledger, Mongoose removed, web adapter |
| then | auth + organizations · Transactions UI · CSV import · Plaid sandbox · metrics + Overview · weekly brief |

The full plan with review history: the owner's plan file referenced in `TODOS.md`.
