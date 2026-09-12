# ADR 0005: Hybrid slice sequencing, ledger underneath, brief early

**Status:** Accepted 2026-09-11 (owner decision at the /autoplan premise gate, option "B")

## Context

The product proposal sequenced a complete accounting engine (feeds, reconciliation, invoicing, AP, multi-user, payroll) before any AI. An independent strategic review argued the opposite: the weekly Money Brief is the only feature incumbents do not offer, and building parity features first risks months without a user. Skipping the ledger entirely would force a second data model later for invoicing, AP, and accountant access.

## Decision

Phase 1 is delivered as two slices.

- **Slice 1** exits when a real user reads a weekly brief over their imported transactions: foundations, organizations and auth, ledger core, Transactions page, CSV import and Plaid sandbox, deterministic metrics on the Overview, and a read-only, feature-flagged weekly brief restricted to observations with conservative wording. The product-brand groundwork (sales channels, clearing accounts, payouts) ships at model level.
- **Slice 2** completes the engine: invoicing, orders and COGS and payout matching, reports, Plaid production, hardening.
- Decision support, simulations, and the conversational advisor stay in Phase 5, after reconciliation exists.

Grounding rules that make an early brief safe: the model receives tested metric IDs and pre-formatted values; output is schema-validated; every number must trace to a metric; derived figures are rejected; URLs and markdown are forbidden; failures fall back to a deterministic summary; every brief stores its input snapshot, model, and raw response for replay.

## Consequences

- First user value in weeks rather than months, without rework later.
- The brief ships before reconciliation, so its scope is observational and its copy is conservative until Phase 2 locks entries.
- Effort visibility: the brief, its validator, evals, and job are rated L (1-2 weeks with Claude Code) inside Slice 1.
