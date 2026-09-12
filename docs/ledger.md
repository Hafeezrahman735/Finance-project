# The ledger

How money is recorded, what the database refuses, and how the pieces the user sees (categories, splits, undo, reconciliation) map onto journal entries. Read this before touching `apps/api/src/services/ledger/` or `apps/api/prisma/`.

## Vocabulary the UI never shows

- **Account**: a bucket in the chart of accounts (`accounts`). Types: asset, liability, equity, income, expense. System accounts are found by `systemKey` (`cash`, `uncategorized`, `sales`, `cogs`, `processor_fees`, `clearing:stripe`, ...); users see `name` and `code`.
- **Journal entry**: one money movement with two or more **lines**. Each line debits or credits exactly one account. Debits equal credits. The UI says "money in", "money out", "transfer"; the words debit and credit stay in this file and in code.
- **Bank-side line**: the line that mirrors a bank or processor row. Never edited after posting. Recategorization changes the *other* side.
- **Sales channel**: a dimension (`channelId`) on revenue, fees, ad spend, COGS, and refund lines so reports can slice by Shopify / TikTok Shop / Etsy.

## Money and dates

- Amounts are `BIGINT` minor units (cents). Never a float in a money path. JSON carries them as numbers below 2^53 (`packages/shared` `assertSafeMinor`). Display goes through `formatMoney` only. (ADR 0002)
- `journal_entries.date` is a `DATE`, meaning a calendar day in `organizations.timezone`. "Last 30 days" is computed from calendar dates, not from `Date.now()`. (ADR 0004, `packages/shared/src/dates.ts`)

## Entry lifecycle (ADR 0004)

```
  post ──▶ POSTED(unlocked) ──recategorize / split (in place, audited)──▶ POSTED(unlocked)
               │
               │ lock (reconciled, or period closed)
               ▼
          POSTED(locked) ──reverse──▶ REVERSED  +  mirror entry (reversesEntryId → original)
```

- Imports create **posted, unlocked** entries against `Uncategorized`. Categorizing re-points the offset line in place and writes an `audit_logs` row with before/after. Splitting replaces one offset line with several that sum to the bank line.
- `version` increments on every in-place edit; clients send the version they loaded and get `409 stale_version` if it moved (two tabs).
- **Lock** happens on reconciliation (Phase 2) or period close. Locked entries accept exactly one change: reverse.
- **Reverse** posts a mirror entry (sides swapped) and marks the original `REVERSED`. Both stay on the books; balances include both, so they net to zero. Reversing is also how Plaid `modified`/`removed` events are handled: reverse, then re-post with the new bank data.
- There is no delete for posted entries. `DRAFT` and `DISCARDED` exist for future manual-entry editing; imports never use them.

## What the database enforces

From `apps/api/prisma/migrations/20260912000000_init/migration.sql` (hand-written tail):

| Rule | Mechanism |
|---|---|
| Each line has exactly one positive side, never negative | `CHECK journal_lines_one_side_positive` |
| A POSTED/REVERSED entry has ≥ 2 lines and debits = credits | deferred constraint trigger `ledger_assert_entry_balanced` (checked at commit, so lines can be written one statement at a time) |
| Locked entries and their lines are immutable, except POSTED → REVERSED | triggers `ledger_guard_entry_update`, `ledger_guard_entry_delete`, `ledger_guard_line_change` |
| The date of a posted entry never changes; posted entries are never deleted | same triggers |
| Bank-side lines of a posted entry keep amount, account, side | `ledger_guard_line_change` |
| Entries and lines never move between organizations | same triggers |
| One entry per `(organization, source, externalRef)` | unique index (idempotent imports and migration) |

The service layer checks the same rules first so users get a `422`/`409` with a named `code` instead of a database error; the triggers exist for the day a bug bypasses the service. `test/ledger.test.ts` writes with raw Prisma to prove the triggers fire.

## Services (`apps/api/src/services/ledger/`)

| Function | Does | Errors (HTTP code) |
|---|---|---|
| `postEntry` | validates lines, checks accounts/channels belong to the org, writes entry + lines + audit row | `unbalanced_entry` 422, `invalid_line` 422, `not_found` 404 (foreign account or channel), `P2002` duplicate externalRef |
| `recategorizeEntry` | replaces non-bank lines with offsets that sum to the bank line; supports splits and channel tags | `entry_locked` 409, `stale_version` 409, `invalid_line` 422, `invalid_transition` 409 |
| `reverseEntry` | mirror entry + mark original REVERSED; allowed on locked entries | `invalid_transition` 409 (not posted, or already reversed) |
| `lockEntries` | sets `locked = true` on posted, unlocked entries; audited per entry | — |
| `trialBalance` / `accountBalance` | per-account debit/credit sums as of a date; debit-normal for asset/expense | — |

All writes run inside `serializable()` (`src/db/prisma.ts`): a SERIALIZABLE transaction with three retries on Postgres serialization failures (`P2034`).

## Processors and clearing accounts (product brands)

A Stripe or Shopify Payments deposit is **not** revenue: it is the net of many orders minus fees minus refunds, days later. Deposits are categorized to a per-processor clearing account (`ensureClearingAccount(tx, orgId, "stripe", "Stripe")` → `clearing:stripe`). Orders post gross sales, fees, and COGS against the clearing account; payout matching (Slice 2) links the deposit to the payouts it covers and moves any variance to `processor_adjustments`. A clearing balance that keeps growing means payouts are missing, which is one of the planted anomalies in the demo organization.

## Default chart

`DEFAULT_CHART` in `chart.ts`: ~28 accounts (cash, AR, undeposited funds, AP, sales tax payable, credit card, opening balance, owner contributions/draws, sales, other income, refunds, COGS, processor fees, shipping, advertising, software, contractors, rent, utilities, office, travel, meals, professional services, bank fees, processor adjustments, other expenses, uncategorized). Seeded per organization; users add more. Codes follow the usual 1000/2000/3000/4000/5000/6000 ranges so a CPA feels at home.

## Migration from the Expense Tracker's MongoDB

`apps/api/scripts/migrate-mongo-to-pg.ts` (`npm run migrate:mongo -w @ledgeriq/api -- --dry-run`): one organization per legacy user; income rows become `Cash / Sales` entries, expense rows become `<category expense account> / Cash` entries; `externalRef` = Mongo `_id` under source `MIGRATION` so re-runs are no-ops. Per-user verification compares ledger totals to the Mongo float sums with a tolerance of 1 cent per row; a user that fails verification is rolled back and reported. `--dry-run` runs everything inside a transaction that is always rolled back.

## Demo organization

`npm run db:seed` builds "Sunny Side Studio" (`demo@ledgeriq.local` / `demo-ledgeriq`): 90 days, Shopify and TikTok Shop channels, orders posting to clearing accounts, weekly batched payouts, daily ad spend by channel, three recurring subscriptions, and two planted anomalies (TikTok fee rate jumps from 6% to 8.1% in the last three weeks; the final Stripe payout never arrives). Deterministic (`seed` argument), so evals can pin numbers.
