# ADR 0002: Money is stored as integer minor units

**Status:** Accepted 2026-09-11

## Context

Amounts today are JavaScript `Number` (IEEE 754 doubles). Summing them drifts; `0.1 + 0.2` is not `0.3`. Accounting software cannot tolerate that.

## Decision

- Database: `amount_minor BIGINT`, non-negative on journal lines; sign is expressed by debit/credit. Every money column carries an ISO 4217 `currency`; one currency per organization for now, but the column exists on lines so multi-currency can be added without a rewrite.
- Wire format: a JSON `number` of minor units, guarded to be below 2^53 at the API boundary (Prisma yields `bigint`, which `JSON.stringify` cannot serialize and charts cannot plot). A serializer test enforces the guard.
- Display: one `formatMoney(minor, currency)` in `packages/shared` using `Intl.NumberFormat`. No other formatting code.
- Migration: legacy floats convert per row with `Math.round(x * 100)`; verification tolerates 1 cent per row against the old float sums.

## Consequences

- No float arithmetic in any money path; ESLint forbids `parseFloat`/`toFixed` on money identifiers (rule added in the TypeScript port).
- Percentages and ratios (margin, ROAS) are computed from integers and rounded only for display.
