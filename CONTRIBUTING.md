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
| `npm run lint` | ESLint in every workspace that defines it |
| `npm run test` | test suites (arrive in PR b) |
| `npm run ci` | lint, test, build in the same order as CI |

Known state after PR (a): `npm run lint` reports 8 pre-existing unused-import errors in `apps/web`; they are removed in the TypeScript port, not patched here.

## Conventions

- Money: integer minor units everywhere (ADR 0002). No `parseFloat`, no `toFixed` on money.
- Tenancy: every query goes through an org-scoped repository (ADR 0003).
- API: plural nouns, sub-resource actions, `camelCase`, `{ data, nextCursor }` lists, structured error envelope (`docs/architecture.md`).
- UI copy: plain language, never "debit" or "credit"; terse, one warm line at most.
- Styling: Tailwind tokens only; no box-shadow except focus rings and the mobile bottom sheet; no gradients.

## Decisions

Durable decisions go in `docs/adr/`. Deferred work goes in `TODOS.md` with enough context that someone can pick it up in three months.
