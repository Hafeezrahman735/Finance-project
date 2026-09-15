# Project status — handoff note

Last updated 2026-09-15. The project is on hold; this is the page to read first when it resumes.

## Where we are in one paragraph

LedgerIQ (working name; trademark unchecked) is the tutorial MERN expense tracker rebuilt into an AI-native financial admin platform for small social-first product brands, following the reviewed plan in `~/.claude/plans/make-a-plan-to-witty-torvalds.md` (a copy of its decisions lives in `docs/adr/` and `TODOS.md`). **Slice 1 of Phase 1 is complete and merged to `master`** (the repo's default branch is `master`, not `main`). Everything runs locally with zero vendor keys: Postgres 18 + Prisma ledger, Express/TypeScript API, React/Vite web app, and offline stand-ins for Plaid, Anthropic, and Resend. GitHub Actions runs the full suite on every push to `master`.

## Built (Slice 1, in merge order)

| Lane | What exists | Where |
|---|---|---|
| PR b–d foundations | TypeScript API, zod tiered config, pino + request ids, error envelope; **double-entry ledger** on Postgres with DB triggers (balanced entries, immutable posted/locked rows), integer minor units, DATE columns + org timezone; org tenancy with roles VIEWER<ACCOUNTANT<BOOKKEEPER<ADMIN<OWNER; generated **authz matrix** test over every route; Mongo data migrated (9 users) and Mongo removed | `apps/api/src/services/ledger`, `prisma/`, `test/authz.test.ts`, `docs/ledger.md` |
| 1.3 Transactions UI | Design tokens (Fraunces/Manrope, one accent, light, no cards/shadows — lint-enforced), Overview headline sentence, Transactions page (uncategorized-first, category picker with splits, undo, bulk, keyboard shortcuts, mobile) | `apps/web/src/pages/{Overview,Transactions}.jsx`, `scripts/check-styles.mjs` |
| 1.4a CSV import | Bank accounts (each with a ledger account), 4-question column mapper with evidence, dedupe, resumable batched commit, categorization rules | `services/banking/{csv,imports}.ts`, `services/rules` |
| 1.1 Auth | 15-min access JWT + httpOnly refresh cookie (rotation, reuse detection, two-tab grace), logout everywhere, password reset, email verification, Resend-or-log email, **rate limits on /auth/*** | `services/auth`, `services/email`, `middleware/rateLimit.ts` |
| E1 Metrics | `GET /metrics`: cash, burn, runway, margin, ROAS, fee rates (blended + per channel), recurring charges, processor clearing lag; stable ids + display strings; daily snapshot cache | `services/metrics` |
| E8 Weekly brief | Anomaly rules → Claude narration (structured output) → grounding validator (numbers must come from the input) → deterministic fallback; one brief per org/week stored with input + raw response; Brief page with evidence popovers; `npm run brief:weekly` email. **Off by default; owner opts in from Settings** | `services/ai`, `docs/ai-brief.md` |
| 1.4b Bank feeds | Plaid Link (sandbox) or offline fixture bank; `/transactions/sync` loop with page-by-page commits, cursor restarts, re-auth detection, modified/removed/pending→posted handled by reverse-and-repost; access tokens AES-256-GCM at rest with key rotation | `services/banking/{feedProvider,feeds}.ts`, `lib/secrets.ts` |

Test counts at the tip: API 98, web 24, shared 25. Run everything with `npm run ci`.

## How to pick it back up

1. `npm install`; Postgres role/DBs per `docs/setup.md` (local Postgres 18, role `ledgeriq`/`ledgeriq`, DBs `ledgeriq` and `ledgeriq_test`; `apps/api/.env` already exists on the original machine).
2. `npm run db:migrate && npm run db:seed` (demo login `demo@ledgeriq.local` / `demo-ledgeriq`, org "Sunny Side Studio" with planted anomalies and the brief opted in).
3. `npm run dev` → http://localhost:5173. Try: Import → Connect a bank (beta) (fixture bank), Sync now, Brief, Settings.
4. Read `TODOS.md` for the ordered backlog; `docs/architecture.md`, `docs/ledger.md`, `docs/ai-brief.md`, `docs/api.md` for the contracts.

## Decisions taken at the merge review (2026-09-13)

- Demo seed may bypass ledger delete guards **in development only** (refuses under `NODE_ENV=production`).
- Weekly brief **default OFF** per organization until the AI data-sharing policy is decided; owners opt in.
- Existing users are "unverified" until they click a link; **configure Resend + `APP_URL` before real users**.
- Auth rate limiting is in; `TRUST_PROXY` must be set behind a load balancer.

## What is still needed for a working MVP (Slice 2 + prerequisites)

Ordered; each item is a lane like the ones above.

**Before any outside tester (P1, mostly non-code)**
1. `RESEND_API_KEY` with a verified domain + `APP_URL`; `NODE_ENV=production`; a real `TOKEN_ENCRYPTION_KEY`; `JWT_SECRET`.
2. Decide the AI data-sharing policy; if OK, `ANTHROPIC_API_KEY` (pay as you go, cents per brief) and record cassettes for CI (`BRIEF_RECORD=true`).
3. Plaid dashboard account (sandbox is free) → replace the fixture bank; start the Plaid production application (calendar time).
4. Trademark check on "LedgerIQ"; positioning one-pager.
5. A host: Railway (MCP is wired) or any Node + Postgres host; set `TRUST_PROXY=1`.

**Slice 2 — complete the engine (plan §1.5–1.7)**
6. **1.5 Basic invoicing**: `Contact`, `Invoice`/`InvoiceLine`, per-org numbering with `FOR UPDATE`, statuses draft→sent→paid|overdue|void, PDF, email send gated on verified email + daily cap, payments posting to the ledger, `PaymentAllocation` for cash-basis reporting.
7. **1.5b Orders, COGS, payout matching** (product-brand core): `Product.unitCostMinor`, `Order`/`OrderLine` with channel, fees, `cogsMinor`; order + payout CSV import; Stripe and Shopify connectors; the payout matcher against clearing accounts (exact → tolerance → date window → multi-payout sets); Orders and Payouts pages. **Run `/plan-eng-review` on 1.5b first** (the plan addendum was never re-reviewed).
8. **1.6 Reports v1**: P&L (cash/accrual, gross-margin section, by-channel view), cash-flow statement, account drill-down, CSV/XLSX export; Overview additions (invoices outstanding).
9. **1.7 Hardening**: golden accuracy fixtures for P&L/balance sheet/cash flow, Playwright E2E on the 5 critical flows, 90% coverage on ledger + reports.
10. Slice 1 follow-ups: Plaid webhook receiver, pg-boss worker (weekly brief schedule, feed sync, shared locks), Settings IA, recorded-cassette brief evals, `/design-consultation` for typeface/palette.

**Then Phase 2** opens with sales tax + the nexus exposure tracker, reconciliation, bills/AP, multi-user invites, remaining channel connectors.

## Constraints to remember

- No Docker on the dev machine; local Postgres already installed. No budget for paid subscriptions: every vendor must have a free tier or an offline fallback (it does today).
- Windows dev machine: Bash heredocs are flaky in this environment; write patch scripts to the scratchpad instead. `gh`, `jq`, Codex are not installed; PRs are opened from compare URLs or `master` is fast-forwarded directly.
- The `ledgeriq` Postgres role has `CREATEDB`; new migrations are generated with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` then `prisma migrate deploy` (see `docs/setup.md`).
