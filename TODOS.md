# TODOS

Deferred work from the /autoplan review of the LedgerIQ roadmap (2026-09-11).
Plan: `~/.claude/plans/make-a-plan-to-witty-torvalds.md`. CEO plan: `~/.gstack/projects/Hafeezrahman735-Expense-Tracker/ceo-plans/2026-09-11-ledgeriq-platform.md`.

## Pre-tester prerequisites (P1, before Slice 1 reaches outside users)

### Configure Resend and APP_URL before the first real user
- **What:** `RESEND_API_KEY` with a verified domain and `APP_URL` = the public web URL; then ask existing users to confirm their email once.
- **Why:** Without a key, verification and reset links are only printed to the server log, so every account stays unverified and nobody can recover a password.
- **Effort:** S (calendar: domain verification).

### Trademark check on the working name
- **What:** Confirm "LedgerIQ" (or the chosen name) is not registered in finance/software before anything public.
- **Why:** Renaming after launch costs domains, emails, and trust.
- **Effort:** S. **Depends on:** nothing.

### Plaid production application
- **What:** Apply for Plaid production access (company details, security questionnaire). Start as soon as Slice 1 has testers.
- **Why:** Approval is calendar time, not effort; Slice 2 bank feeds depend on it. CSV import is the launch path until then.
- **Effort:** S effort, weeks of calendar time. **Depends on:** a company entity and a privacy policy.

### Positioning one-pager
- **What:** Who, pain, why now, why us, how paid, the one feature that makes someone switch.
- **Why:** The CEO review found the plan had no named customer wedge or pricing hypothesis. Slice 1 testers should be recruited against this.
- **Effort:** S. **Depends on:** nothing.

## Deferred features

### Recurring-charge anomaly alerting (Phase 4)
- **What:** A new recurring charge appearing (not just a jump) as its own rule; push/email alerting between briefs.
- **Why:** The jump rule and in-brief delivery landed in E8; "new subscription" needs more history to be reliable.
- **Effort:** S. **Depends on:** metrics history beyond 90 days.

### Brief evals: recorded cassettes and a nightly live run (E8 follow-up)
- **What:** Record `claude-opus-5` responses for the demo org into `apps/api/fixtures/cassettes/brief/` (`AI_PROVIDER=anthropic BRIEF_RECORD=true`), run them in CI via `AI_PROVIDER=recorded`, and a nightly live job asserting planted-anomaly recall ≥ 95% and zero ungrounded numbers.
- **Why:** CI today covers the pipeline with a scripted fake model; the model's own behaviour is untested until there is an API key.
- **Effort:** S. **Depends on:** `ANTHROPIC_API_KEY` (pay as you go).

### Shared rate-limit store
- **What:** Move the `/auth/*` limiter counters from process memory to Postgres or Redis.
- **Why:** Limits are per process today; with two API instances an attacker gets double the budget.
- **Effort:** S. **Depends on:** running more than one API instance.

### pg-boss worker: weekly brief schedule and Plaid sync (Slice 1 → 1.4b)
- **What:** Replace the cron entry for `npm run brief:weekly` with a pg-boss `singletonKey` job, and host the Plaid sync there.
- **Why:** One worker process for every job; the plan's failure-mode table assumes queue retries.
- **Effort:** S. **Depends on:** 1.4b starting.

### Accountant read-only invite and multi-org switcher (Phase 2)
- **What:** Invite by email with role, accountant view (read-only + export + comments), and the org switcher UI.
- **Why:** Accountant access is a headline value prop; `Membership` and org middleware already land in Slice 1 so this is UI + email.
- **Effort:** M. **Depends on:** email verification (done, lane 1.1).

### Sales-tax rate on invoice and order lines + nexus exposure tracker (Phase 2, first item)
- **What:** Per-line tax rate, tax-payable tracking, tax-collected report, sales-by-destination-state against economic-nexus thresholds with 80% warnings.
- **Why:** Deferred at taste decision T1, but urgent for social-first product brands selling nationally; a service business rarely trips nexus, a product brand does.
- **Effort:** M. **Depends on:** Slice 2 orders (shipping addresses).

### TikTok Shop and Amazon connectors (Phase 2+)
- **What:** Orders + payouts APIs once partner/developer access is granted; CSV import covers both until then.
- **Why:** Both channels gate API access; do not block Slice 2 on approvals.
- **Effort:** M each. **Depends on:** partner API approval.

### Sales-tax rate calculation integration (TaxJar/Avalara-style)
- **What:** Escape hatch for jurisdiction-level rate calculation and filing once tracking/nexus warnings are not enough.
- **Why:** We track and warn; we do not calculate rates or file.
- **Effort:** M. **Depends on:** Phase 2 sales tax, paying product-brand users.

### QuickBooks/Xero app-store distribution experiment (Phase 4+)
- **What:** Ship the Money Brief as an app over QuickBooks/Xero data as a go-to-market test.
- **Why:** Solves distribution, ledger, and feeds for the one novel feature; a way to validate the brief with users who will not switch books.
- **Effort:** M. **Depends on:** Phase 4 brief and metrics layer being source-agnostic.

### Multi-currency readiness review
- **What:** Before the first non-US user, review `currency` on lines, FX tables, and report conversion.
- **Why:** Premise P11 is US-first; the schema leaves room but nothing is implemented.
- **Effort:** M. **Depends on:** a non-US user.

### /design-consultation for typeface and palette
- **What:** Pick the two typefaces and accent color before 1.3 UI work; produce DESIGN.md.
- **Why:** Design review scored design-system alignment 6/10 without it.
- **Effort:** S. **Depends on:** nothing.

### Settings information architecture and states
- **What:** Org settings, bank connections, rules management, members; loading/empty/error states.
- **Why:** Out of scope for the Slice 1 design spec.
- **Effort:** S. **Depends on:** Slice 1 shell.

### Slice 1 follow-ups
- Plaid webhook receiver with local tunnel (`/sandbox/item/fire_webhook`); Slice 1 uses "Sync now" polling.
- Email verification, password reset (lane 1.1) and the emailed brief (lane E8, `npm run brief:weekly`) have landed.
- Gate outbound sends (invoices, Slice 2) on `emailVerifiedAt`; the flag is exposed on `/auth/me` today.

## Developer experience

### Devcontainer
- **What:** `.devcontainer` with Postgres service.
- **Why:** Only worthwhile once a second contributor appears.
- **Effort:** S.

### Elm-tier error prose
- **What:** Conversational, first-person messages with the exact fix for the five most common 4xx codes.
- **Why:** DX review reached Stripe-tier structure (code/param/requestId); prose quality is the next step.
- **Effort:** S. **Depends on:** error envelope (Slice 1).

### CHANGELOG.md
- **What:** Start at the first tagged release.
