# ADR 0003: The organization is the tenant, not the user

**Status:** Accepted 2026-09-11

## Context

Data is scoped by `userId` today, and two routes forget even that. The product promises that an owner and their bookkeeper or CPA see the same live books, and that one person may run more than one business.

## Decision

- `Organization` owns every business record (`organization_id NOT NULL` everywhere). Users join through `Membership { role: owner | admin | bookkeeper | accountant | viewer }`.
- The active organization is selected by the `X-Organization-Id` header; middleware asserts membership and role before any controller runs.
- Repositories take `organizationId` as a required, typed first argument (`Scoped<T>`); controllers never call Prisma directly. An authz matrix generated from the route table tests every route for every role against a foreign organization.
- Multi-user UI (invites, org switcher) ships in Phase 2; the model and middleware ship in Slice 1 because retrofitting tenancy onto user-scoped data would be the most expensive migration in the plan.

## Consequences

- Signup creates an organization and an owner membership in one transaction.
- Every list, report, metric, and brief is per organization by construction.
