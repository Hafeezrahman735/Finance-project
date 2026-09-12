# ADR 0006: Prisma 7 with the pg driver adapter; ledger invariants as SQL in migrations

**Status:** Accepted 2026-09-12

## Context

ADR 0001 chose Postgres + Prisma. Prisma 7 is the current major: it requires a driver adapter (`@prisma/adapter-pg`), a `prisma.config.ts` for the datasource URL, and an explicit generated-client output path. Prisma does not model CHECK constraints or triggers, but the ledger rules (balanced entries, immutable locked entries, immutable bank-side lines) must hold even when a bug bypasses the service layer.

## Decision

- Prisma 7 with `@prisma/adapter-pg`; the client is generated into `apps/api/src/generated/prisma` (gitignored, rebuilt by `postinstall`).
- Ledger invariants live as hand-written SQL appended to the migration that creates the tables (`20260912000000_init`): a CHECK for one-positive-side lines, a deferred constraint trigger for balance, and BEFORE triggers guarding locked entries, posted-entry dates, and bank-side lines. Future rule changes ship the same way: schema change via `prisma migrate dev`, then SQL added to the generated migration.
- The service layer validates first and returns coded 4xx errors; the triggers are the last line of defense and are exercised by tests that write with raw Prisma.
- Ledger writes use SERIALIZABLE transactions with retry on serialization failure.

## Consequences

- `prisma migrate diff` cannot express the triggers, so drift detection ignores them; `docs/ledger.md` lists every rule and the tests prove each fires.
- Local development needs no Docker: any `DATABASE_URL` works (`scripts/create-local-db.sql` for an existing install, `docker-compose.yml` as an option, Neon/Aiven free tiers for hosting).
