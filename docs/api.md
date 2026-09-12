# API reference (`/api/v1`)

Source of truth: the route table in `apps/api/src/routes.ts`. Every route there is exercised by the generated authz matrix (`apps/api/test/authz.test.ts`); a route not in the table does not exist. This page is the human-readable mirror; `zod-openapi` generation is a TODO.

## Conventions

- JSON, `camelCase`. Money is an integer number of minor units (`amountMinor: 1250` = $12.50). Dates are calendar dates `YYYY-MM-DD` in the organization's timezone.
- Auth: `Authorization: Bearer <token>` (JWT from register/login). Active organization: `X-Organization-Id: <uuid>`; omitted = your primary organization. A foreign or unknown organization id is a `404`, never `403`.
- Lists: `{ "data": [...], "nextCursor": "..." | null }` with `?cursor=&limit=` (keyset on date desc, id desc).
- Errors: `{ "message", "error": { "type", "code", "message", "param"?, "requestId" } }`. Switch on `code`. The same `requestId` is on the `X-Request-Id` response header and in the API log line.
- Roles: `VIEWER` < `ACCOUNTANT` < `BOOKKEEPER` < `ADMIN` < `OWNER`. Reads need `VIEWER`; writes need `BOOKKEEPER`. Below the minimum: `403 insufficient_role`.

## Routes

| Method | Path | Access | Body / query | Returns |
|---|---|---|---|---|
| POST | `/auth/register` | public | `fullName, email, password, organizationName?, timezone?` | `201 { id, user, organization, token }` |
| POST | `/auth/login` | public | `email, password` | `{ id, user, organization, token }` |
| GET | `/auth/me` | auth | — | `{ user, organization }` |
| GET | `/organizations` | auth | — | `{ data: [ { id, name, currency, timezone, role } ] }` |
| GET | `/organizations/current` | VIEWER | — | `{ id, name, currency, timezone, role }` |
| GET | `/accounts` | VIEWER | — | `{ data: [ { id, name, code, type, systemKey } ] }` |
| GET | `/dashboard` | VIEWER | — | totals, cash on hand, uncategorized count, 30/60-day windows, recent transactions (all in minor units) |
| GET | `/transactions` | VIEWER | `cursor, limit≤200, direction=in\|out, status=uncategorized\|all, from, to, includeReversed` | `{ data: Transaction[], nextCursor }` |
| GET | `/transactions/export.xlsx` | VIEWER | same filters | `.xlsx` stream |
| POST | `/transactions` | BOOKKEEPER | `direction, amountMinor, date, memo?, accountId?, bankAccountId?, channelId?` | `201 Transaction` |
| GET | `/transactions/:id` | VIEWER | — | `Transaction` |
| PATCH | `/transactions/:id` | BOOKKEEPER | `version` + either `lines: [{ accountId, amountMinor, channelId? }]` (recategorize/split, any source) or `amountMinor/date/memo/direction` (manual entries only; returns a **new** id) | `Transaction` |
| POST | `/transactions/:id/reverse` | BOOKKEEPER | — | `{ original, reversal }` |
| DELETE | `/transactions/:id` | BOOKKEEPER | — | alias for reverse; `{ message, original, reversal }` |
| GET | `/bank-accounts` | VIEWER | — | `{ data: [ { id, name, kind, accountId, currency, mask } ] }` |
| POST | `/bank-accounts` | BOOKKEEPER | `name, kind=CHECKING\|SAVINGS\|CREDIT_CARD\|CASH\|OTHER, mask?` | `201 BankAccount` (creates its ledger account, systemKey `bank:<id>`) |
| GET | `/imports` | VIEWER | — | `{ data: Import[] }` (last 50) |
| POST | `/imports` | BOOKKEEPER | multipart: `file` (CSV ≤ 10 MB, ≤ 50,000 rows), `bankAccountId` | `201 { import, guess: { mapping, evidence, dateAmbiguous }, sample }` |
| GET | `/imports/:id` | VIEWER | — | `Import` (status, counts, mapping, error) |
| GET | `/imports/:id/preview` | VIEWER | — | `{ newRows, duplicateRows, invalidRows }` |
| POST | `/imports/:id/mapping` | BOOKKEEPER | `dateColumn, descriptionColumn, amountColumn \| debitColumn+creditColumn, dateFormat=auto\|YMD\|MDY\|DMY, signConvention=negativeIsOut\|positiveIsOut` | `{ import, preview }`; rows become NEW / DUPLICATE / INVALID |
| POST | `/imports/:id/commit` | BOOKKEEPER | `includeDuplicates?: number[]` (row indexes to import anyway) | `Import` with status COMMITTED; batches of 500; safe to call again after a failure (resumes) |
| GET | `/rules` | VIEWER | — | `{ data: [ { id, pattern, match, accountId, accountName, channelId, priority, hitCount } ] }` |
| POST | `/rules` | BOOKKEEPER | `pattern, match=CONTAINS\|EXACT\|REGEX, accountId, channelId?, priority?, applyToExisting=true` | `201 { rule, applied }` (`applied` = uncategorized rows recategorized now) |
| DELETE | `/rules/:id` | BOOKKEEPER | — | archives the rule |

`GET /healthz` (no prefix) returns `{ ok: true }` after a `SELECT 1`.

## Transaction

```json
{
  "id": "uuid",
  "date": "2026-09-12",
  "memo": "PIRATE SHIP",
  "direction": "out",
  "amountMinor": 3080,
  "currency": "USD",
  "bankAccount": { "id": "uuid", "name": "Cash" },
  "lines": [{ "accountId": "uuid", "accountName": "Uncategorized", "amountMinor": 3080, "channelId": null }],
  "categoryName": "Uncategorized",
  "uncategorized": true,
  "status": "POSTED",
  "locked": false,
  "source": "BANK",
  "version": 1,
  "reversesEntryId": null
}
```

`categoryName` is `"Split"` when `lines` has more than one entry. Reversed entries and their reversals are hidden from lists unless `includeReversed=true`.

## Error codes you will see

| Code | Status | Meaning |
|---|---|---|
| `invalid_param` | 400 | zod validation failed; `param` names the field |
| `invalid_json` | 400 | body is not JSON |
| `missing_token`, `invalid_token`, `unknown_user`, `invalid_credentials`, `no_organization` | 401 | authentication |
| `insufficient_role` | 403 | role below the route's minimum |
| `not_found`, `entry_not_found`, `organization_not_found`, `route_not_found` | 404 | includes foreign ids and malformed ids |
| `email_taken`, `bank_account_exists` | 409 | register / bank accounts |
| `import_not_mapped`, `import_committed` | 409 | import step out of order |
| `file_too_large`, `too_many_rows` | 400 | upload limits |
| `stale_version` | 409 | the entry changed since you loaded it; reload and retry |
| `entry_locked`, `invalid_transition` | 409 | reconciled/closed entry, or an operation the entry's state does not allow |
| `unbalanced_entry`, `invalid_line`, `currency_mismatch` | 422 | ledger validation |
| `internal_error` | 500 | quote `requestId` when reporting |
