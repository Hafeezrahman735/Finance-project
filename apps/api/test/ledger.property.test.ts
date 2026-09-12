import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EntrySource } from "../src/generated/prisma/enums.js";
import { postEntry, reverseEntry, trialBalance } from "../src/services/ledger/ledger.js";
import { createOrgFixture, describePg, usePg } from "./pg.js";

const run = describePg() ? describe : describe.skip;

/**
 * Property tests (CEO review Section 6): for ANY sequence of balanced random
 * entries, the trial balance balances; reversing any subset nets those entries
 * to zero. Small run counts because each case hits Postgres.
 */
run("ledger properties", () => {
  const db = usePg();

  // A balanced entry: 2..5 lines, random accounts, integer minor units, debits == credits.
  const balancedEntry = fc
    .array(fc.integer({ min: 1, max: 5_000_00 }), { minLength: 1, maxLength: 3 })
    .chain((debits) =>
      fc.array(fc.integer({ min: 1, max: 5_000_00 }), { minLength: 1, maxLength: 2 }).map((creditParts) => {
        const total = debits.reduce((a, b) => a + b, 0);
        // Scale credit parts so they sum to `total` exactly (last part absorbs rounding).
        const partsTotal = creditParts.reduce((a, b) => a + b, 0);
        const credits = creditParts.map((p) => Math.floor((p / partsTotal) * total));
        credits[credits.length - 1]! += total - credits.reduce((a, b) => a + b, 0);
        return { debits, credits: credits.filter((c) => c > 0) };
      }),
    );

  it("any sequence of balanced entries yields a balanced trial balance", async () => {
    const f = await createOrgFixture(db());
    const accounts = await Promise.all(["cash", "sales", "rent", "software", "advertising", "accounts_receivable", "owner_draws"].map((k) => f.account(k)));

    await fc.assert(
      fc.asyncProperty(fc.array(balancedEntry, { minLength: 1, maxLength: 6 }), fc.integer({ min: 0, max: accounts.length - 1 }), async (entries, seed) => {
        for (const e of entries) {
          const lines = [
            ...e.debits.map((d, i) => ({ accountId: accounts[(seed + i) % accounts.length]!, debitMinor: d })),
            ...e.credits.map((c, i) => ({ accountId: accounts[(seed + i + 3) % accounts.length]!, creditMinor: c })),
          ];
          await postEntry(db(), { organizationId: f.orgId, date: "2026-09-01", source: EntrySource.MANUAL, lines });
        }
        const tb = await trialBalance(db(), f.orgId);
        expect(tb.totalDebitMinor).toBe(tb.totalCreditMinor);
        const debitNormal = tb.rows.filter((r) => r.type === "ASSET" || r.type === "EXPENSE").reduce((s, r) => s + r.balanceMinor, 0);
        const creditNormal = tb.rows.filter((r) => !(r.type === "ASSET" || r.type === "EXPENSE")).reduce((s, r) => s + r.balanceMinor, 0);
        expect(debitNormal).toBe(creditNormal);
      }),
      { numRuns: 8 },
    );
  });

  it("reversing every entry nets every account to zero", async () => {
    const f = await createOrgFixture(db());
    const cash = await f.account("cash");
    const sales = await f.account("sales");
    const rent = await f.account("rent");

    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: 1, max: 1_000_00 }), { minLength: 1, maxLength: 5 }), async (amounts) => {
        const ids: string[] = [];
        for (const [i, amount] of amounts.entries()) {
          const lines = i % 2 === 0 ? [{ accountId: cash, debitMinor: amount }, { accountId: sales, creditMinor: amount }] : [{ accountId: rent, debitMinor: amount }, { accountId: cash, creditMinor: amount }];
          ids.push((await postEntry(db(), { organizationId: f.orgId, date: "2026-09-01", source: EntrySource.MANUAL, lines })).id);
        }
        for (const id of ids) await reverseEntry(db(), { organizationId: f.orgId, entryId: id });
        const tb = await trialBalance(db(), f.orgId);
        expect(tb.rows.every((r) => r.balanceMinor === 0)).toBe(true);
      }),
      { numRuns: 6 },
    );
  });
});
