# The weekly Money Brief

The brief is the product's differentiator and the only place a language model touches the app. It is **observational**: it narrates numbers the metrics layer computed, cites them, and suggests a reversible next step. It never computes, never writes to the ledger, and never sees raw transaction rows.

```
  ledger ─▶ services/metrics ─▶ services/ai/anomalies ─▶ BriefInput ─▶ model ─▶ validateBrief ─┬─ ok ─▶ GENERATED
                                                                          ▲            │ fail    │
                                                                          └─ retry once ┘         │
              insufficient data / model off / refused / malformed / failed twice ─▶ fallbackBrief ─▶ DEGRADED
```

Code: `apps/api/src/services/ai/` — `schema.ts` (contract), `anomalies.ts` (rules), `grounding.ts` (validator), `fallback.ts` (deterministic summary), `model.ts` (providers), `brief.ts` (service, storage, email).

## What the model receives

`BriefInput` (stored verbatim on `ai_insights.input_snapshot`):

- the organization name and currency, the week (`periodStart`..`periodEnd`), the 30-day window and the prior 30, and `dataDays`;
- every metric from `GET /metrics` as `{ id, label, display, window, prev?, note?, channel? }` — **display strings, not raw numbers** (`"$2,350.46"`, `"57.0%"`, `"3.0x"`, `"9 days"`);
- the anomalies the rules found, each with a deterministic sentence, the metric ids behind it, and a suggested step.

Transaction memos reach the model only as merchant names inside recurring-charge labels; the system prompt states that memo text is untrusted data.

## What the model must return

`MoneyBrief` (`schema.ts`, enforced by the API's structured-output JSON schema and again by zod):

```
{ headline, warm_line,
  findings[1..5]: { claim, evidence_metric_ids[1..6], severity: info|warning|high },
  suggested_actions[1..3]: { action, reason, confidence: low|medium|high },
  disclaimer }
```

Tone (taste decision T3): terse CFO, one warm line. The headline leads with gross margin for a product brand.

## Grounding contract (`grounding.ts`)

A brief is accepted only if:

1. every `evidence_metric_ids` entry exists in the input;
2. every number in any text field equals an input display value — exactly, rounded to the unit (`$8,713` for `$8,713.29`), or within 5% when written as `1.2K`/`2M`; numbers in `note` fields, anomaly sentences, the window lengths (7, 30, 90) and `dataDays` are also allowed. Derived figures (differences, invented percentages) are rejected;
3. no URL, markdown, or HTML anywhere (links in the UI come only from metric ids, so injected memo text cannot steer a reader).

Dates (`2026-09-03`, `Sep 3, 2026`) are stripped before number matching. On failure the model is asked once more with the validator's errors as feedback; a second failure logs an error (a quality signal to watch) and the deterministic summary is stored instead.

## Anomaly rules (`anomalies.ts`, thresholds in `THRESHOLDS`)

| Rule | Fires when | Severity |
|---|---|---|
| `recurring_jump` | a recurring charge is ≥ 20% above its previous occurrence | warning; high at ≥ 100% |
| `fee_rate_drift` | a channel's effective fee rate rose ≥ 1 point vs the prior 30 days | warning |
| `payout_missing` | a processor clearing balance > 0 and ≥ 10 days since its last deposit | high |
| `roas_drop` | a channel's ROAS fell below 80% of the prior window's | warning; high under 1.0x |
| `margin_negative` | a channel's gross margin < 0 with revenue > 0 | high |
| `low_runway` | runway < 60 days (high) or < 120 days (warning) | high / warning |
| `burn_up` | net cash burn > 1.5× the prior window's | warning |
| `uncategorized_backlog` | ≥ 10 transactions need a category | info |

Every sentence is built only from metric display strings, so the fallback brief passes the validator too (tested).

## Providers (`model.ts`, `AI_PROVIDER`)

| Provider | When | Behaviour |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` set (default) | `claude-opus-5` (`AI_MODEL`), adaptive thinking, cached system prompt, structured output. With `BRIEF_RECORD=true` every response is also written to `BRIEF_CASSETTE_DIR/<prompt-hash>.json`. |
| `recorded` | CI / zero-key dev with cassettes | Replays the cassette for the exact prompt; a missing cassette is a hard error so CI never degrades silently. |
| `off` | no key (default) | No model call; the deterministic summary is stored as `DEGRADED` with reason `model_unavailable`. |

Model errors are caught by class (`AuthenticationError`, `RateLimitError`, `APIError`) and become `ModelUnavailableError`; refusals (`stop_reason: "refusal"`), empty output, and schema failures are distinct `failure` values on the stored row.

## Storage, idempotency, cost

- One row per `(organization, WEEKLY_BRIEF, periodStart)`; `periodStart` is the Monday of the current week in the organization's timezone.
- `GET /briefs/current` generates on the first read of a week and returns the stored row afterwards; `?peek=1` (the Overview's one-line preview) does not consume the first-open reveal.
- `POST /briefs/current/regenerate` (admin) is capped at 3 per week (`429 brief_regeneration_limit`).
- `npm run brief:weekly` generates for every organization with the `moneyBrief` flag on and emails verified owners/admins once (`emailed_at`); a stored brief whose email failed is re-sent, not regenerated. Run it from cron on Monday mornings until the pg-boss worker lands.
- Per-organization flag: `organizations.feature_flags = { "moneyBrief": false }` switches the brief off (`GET /briefs/current` → `{ enabled: false }`).
- Under 14 data days in the last 90 the model is not called at all (`insufficient_data`).

## Replaying a brief

`ai_insights` keeps `input_snapshot`, `raw_response`, `model`, `prompt_version`, `request_id`, and `degraded_reason`. To reproduce a brief weeks later: load the row, rebuild the prompt with `buildUserPrompt(inputSnapshot)`, and compare against `raw_response`. `PROMPT_VERSION` changes whenever the system prompt or the input layout changes, which also changes every cassette key.

## Evals (status)

- CI: the service is exercised with a scripted fake model covering grounded success, a grounding failure with retry, refusal, model-off, insufficient data, the regeneration cap, and email delivery (`apps/api/test/brief.test.ts`); the anomaly rules and fallback are pinned on the demo organization's planted anomalies.
- Nightly live run against `claude-opus-5` with recorded cassettes and the recall / zero-fabricated-numbers thresholds from the plan: **not yet wired** (needs an API key; TODOS.md).
