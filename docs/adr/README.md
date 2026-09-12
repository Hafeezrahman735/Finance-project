# Architecture Decision Records

One file per durable decision. Format: context, decision, consequences, status. Add a new numbered file rather than editing an accepted one; supersede by reference.

| # | Decision | Status |
|---|---|---|
| 0001 | Postgres + Prisma replace MongoDB for the ledger | Accepted 2026-09-11 |
| 0002 | Money is stored as integer minor units | Accepted 2026-09-11 |
| 0003 | The organization is the tenant, not the user | Accepted 2026-09-11 |
| 0004 | Imported entries are edited in place until locked | Accepted 2026-09-11 |
| 0005 | Hybrid slice sequencing: ledger underneath, brief early | Accepted 2026-09-11 |
