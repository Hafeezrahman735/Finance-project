# ADR 0004: Imported entries are edited in place until locked

**Status:** Accepted 2026-09-11 (revised during the spec review of the CEO plan)

## Context

A bank import creates one journal entry per bank row: the bank account on one side, `Uncategorized` on the other. Users then categorize, often several times, sometimes in bulk. A strict "posted entries are immutable; every change is a reversing entry" rule would double entry volume on every recategorization and bury the audit trail in noise. Xero and QuickBooks allow edits until an entry is reconciled or its period is closed.

## Decision

- `JournalEntry` has `status` (`draft | posted | reversed | discarded`) and `locked` (boolean).
- Imports create `posted`, unlocked entries. While unlocked, the non-bank side may be re-pointed (recategorized, or split into N lines that sum to the bank line) in place, always writing an `AuditLog` row with before/after. The bank-side line, date, and amount are never edited after import.
- An entry becomes `locked` when it is reconciled or its period is closed. Locked entries are immutable; corrections are reversing entries (`reversesEntryId`). A database trigger denies updates that violate these rules.
- Plaid `modified` and `removed` events are the exception that proves the rule: they reverse and re-post (carrying the category), because the bank side itself changed.
- Processor deposits (Stripe, Shopify Payments, PayPal, Square) are categorized to a per-processor clearing account, never to revenue; payout matching posts the gross sales, fees, and refunds behind each deposit.

## Consequences

- Entry volume stays proportional to real activity; the audit log stays readable.
- Reconciliation (Phase 2) gains a concrete meaning: it locks.
- Reports over unlocked periods can change as users categorize; the Overview says so ("based on uncategorized data") until the queue is empty.
