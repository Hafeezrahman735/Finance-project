# Contributing

## Setup

See `docs/setup.md`. One `npm install` at the root; never inside `apps/*`.

## Branches and PRs

- Branch from `master`; name by lane: `slice1/pr-b-typescript-port`, `slice1/csv-import`, `slice2/orders-cogs`.
- Keep PRs to one lane. The Slice 1 foundations land as four PRs (workspaces, TypeScript port, Prisma + ledger, cut over) so each is independently revertible.
- Migrations are additive within a release; drops wait one release. No backfills inside migrations; backfills are jobs.
- Every PR that adds a route adds it to the route table so the generated authz matrix covers it (from PR b onward).
- Diagrams in code comments (ledger state machine, Plaid sync loop, brief pipeline) are part of the change: update them in the same commit.

## Commands

| Command | What |
|---|---|
| `npm run dev` | api + web together |
| `npm run dev:api` / `npm run dev:web` | one side |
| `npm run build` | web production build |
| `npm run lint` | ESLint in every workspace (must be clean) |
| `npm run typecheck` | `tsc --noEmit` for the API |
| `npm run test` | Shared tests + API suite. Ledger tests need `TEST_DATABASE_URL` (truncated!); legacy route tests use an in-memory MongoDB (first run downloads mongod) |
| `npm run setup` | `prisma migrate deploy` + seed the demo organization |
| `npm run db:migrate:dev -w @ledgeriq/api -- --name <change>` | Create a new migration after editing `prisma/schema.prisma` |
| `npm run ci` | lint, typecheck, test, build in the same order as GitHub Actions |

Tests: every route gets a happy-path test, a validation test, an auth-required test, and an ownership test (user A cannot touch user B's rows). Add to `apps/api/test/`; `helpers.ts` gives you `makeApp()`, `signup()`, and `auth(token)`; `pg.ts` gives you `usePg()` and `createOrgFixture()` for ledger tests. Anything that changes ledger rules also needs a raw-Prisma test proving the database rejects the bypass (see `ledger.test.ts` → database invariants).

Schema changes: edit `apps/api/prisma/schema.prisma`, run `npm run db:migrate:dev -w @ledgeriq/api -- --name <change>`, and if the change touches ledger rules add the SQL for triggers/checks to the generated migration by hand (Prisma does not model them). Migrations are additive within a release.

## Conventions

- Money: integer minor units everywhere (ADR 0002). No `parseFloat`, no `toFixed` on money.
- Tenancy: every query goes through an org-scoped repository (ADR 0003).
- API: plural nouns, sub-resource actions, `camelCase`, `{ data, nextCursor }` lists, structured error envelope (`docs/architecture.md`).
- UI copy: plain language, never "debit" or "credit"; terse, one warm line at most.
- Styling: Tailwind tokens only; no box-shadow except focus rings and the mobile bottom sheet; no gradients.

## Decisions

Durable decisions go in `docs/adr/`. Deferred work goes in `TODOS.md` with enough context that someone can pick it up in three months.
