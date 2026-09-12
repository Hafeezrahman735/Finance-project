# ADR 0001: Postgres + Prisma replace MongoDB for the ledger

**Status:** Accepted 2026-09-11 (owner decision at the /autoplan premise gate, option "A2")

## Context

The Expense Tracker stores `Income` and `Expense` documents in MongoDB with no constraints, float amounts, and no ownership check on updates. The target product is an accounting ledger: every entry must balance, every row must belong to exactly one organization, and reports are joins and aggregates across accounts and periods.

Alternatives considered: stay on MongoDB with invariants in application code and Atlas multi-document transactions; a ledger-as-a-service vendor; a greenfield rewrite on a different framework.

## Decision

Rebuild the data layer on Postgres via Prisma, ported to TypeScript in one pass. Keep the Express route/controller/middleware shape and the React shell, auth flow, and axios layer. Migrate existing Mongo data with a one-time, idempotent, dry-runnable script that verifies per-user totals within 1 cent per row before Mongo is retired.

## Consequences

- Balance, foreign-key, and tenancy invariants are enforced by the database, not by discipline.
- Local development needs a Postgres (Docker Compose by default; any `DATABASE_URL` works).
- The owner learns Prisma; the schema file doubles as documentation.
- Prisma returns `bigint` for `BIGINT`, so the wire format needs a serializer (ADR 0002).
- Drizzle was the runner-up (taste decision T2); switching later would be costly once the ledger exists.
