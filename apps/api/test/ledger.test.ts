import { describe, expect, it } from "vitest";
import { EntrySource } from "../src/generated/prisma/enums.js";
import { ensureClearingAccount } from "../src/services/ledger/chart.js";
import { getEntry, lockEntries, postEntry, recategorizeEntry, reverseEntry, trialBalance } from "../src/services/ledger/ledger.js";
import { createOrgFixture, describePg, usePg, type Fixture } from "./pg.js";

const run = describePg() ? describe : describe.skip;

run("ledger", () => {
  const db = usePg();

  async function fixture(): Promise<Fixture> {
    return createOrgFixture(db());
  }

  async function postBankRow(f: Fixture, amountMinor: number, direction: "in" | "out", externalRef?: string) {
    const cash = await f.account("cash");
    const uncategorized = await f.account("uncategorized");
    const bankLine = direction === "in" ? { accountId: cash, debitMinor: amountMinor, isBankSide: true } : { accountId: cash, creditMinor: amountMinor, isBankSide: true };
    const offset = direction === "in" ? { accountId: uncategorized, creditMinor: amountMinor } : { accountId: uncategorized, debitMinor: amountMinor };
    return postEntry(db(), {
      organizationId: f.orgId,
      date: "2026-09-01",
      memo: "STRIPE TRANSFER",
      source: EntrySource.BANK,
      externalRef: externalRef ?? null,
      lines: [bankLine, offset],
      actor: { userId: f.userId, requestId: "req-1" },
    });
  }

  describe("post", () => {
    it("posts a balanced entry, converts BIGINT to numbers, and writes an audit row", async () => {
      const f = await fixture();
      const entry = await postBankRow(f, 47200, "in", "txn_1");
      expect(entry.status).toBe("POSTED");
      expect(entry.locked).toBe(false);
      expect(entry.date).toBe("2026-09-01");
      expect(entry.version).toBe(1);
      expect(entry.lines).toHaveLength(2);
      expect(entry.lines[0]).toMatchObject({ debitMinor: 47200, creditMinor: 0, isBankSide: true, currency: "USD", position: 0 });
      expect(entry.lines[1]).toMatchObject({ debitMinor: 0, creditMinor: 47200, isBankSide: false, position: 1 });

      const audit = await db().auditLog.findMany({ where: { organizationId: f.orgId } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ action: "entry.post", entityType: "JournalEntry", entityId: entry.id, actorUserId: f.userId, requestId: "req-1" });
    });

    it("rejects unbalanced entries before touching the database", async () => {
      const f = await fixture();
      const cash = await f.account("cash");
      const sales = await f.account("sales");
      await expect(
        postEntry(db(), { organizationId: f.orgId, date: "2026-09-01", source: EntrySource.MANUAL, lines: [{ accountId: cash, debitMinor: 100 }, { accountId: sales, creditMinor: 99 }] }),
      ).rejects.toMatchObject({ code: "unbalanced_entry", status: 422 });
      expect(await db().journalEntry.count()).toBe(0);
    });

    it.each([
      ["single line", [{ accountId: "cash", debitMinor: 100 }], "invalid_line"],
      ["both sides", [{ accountId: "cash", debitMinor: 100, creditMinor: 100 }, { accountId: "sales", creditMinor: 0 }], "invalid_line"],
      ["negative", [{ accountId: "cash", debitMinor: -100 }, { accountId: "sales", creditMinor: 100 }], "invalid_line"],
      ["float", [{ accountId: "cash", debitMinor: 10.5 }, { accountId: "sales", creditMinor: 10.5 }], "amount_not_integer"],
    ])("rejects %s lines", async (_label, lines, code) => {
      const f = await fixture();
      const resolved = await Promise.all(lines.map(async (l) => ({ ...l, accountId: await f.account(l.accountId) })));
      await expect(postEntry(db(), { organizationId: f.orgId, date: "2026-09-01", source: EntrySource.MANUAL, lines: resolved })).rejects.toMatchObject({ code });
    });

    it("refuses accounts and channels from another organization with a 404", async () => {
      const a = await fixture();
      const b = await fixture();
      const cashB = await b.account("cash");
      const salesA = await a.account("sales");
      await expect(
        postEntry(db(), { organizationId: a.orgId, date: "2026-09-01", source: EntrySource.MANUAL, lines: [{ accountId: cashB, debitMinor: 100 }, { accountId: salesA, creditMinor: 100 }] }),
      ).rejects.toMatchObject({ code: "not_found", status: 404 });

      const channelB = await db().salesChannel.create({ data: { organizationId: b.orgId, kind: "SHOPIFY", name: "Shop" } });
      const cashA = await a.account("cash");
      await expect(
        postEntry(db(), { organizationId: a.orgId, date: "2026-09-01", source: EntrySource.MANUAL, lines: [{ accountId: cashA, debitMinor: 100 }, { accountId: salesA, creditMinor: 100, channelId: channelB.id }] }),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("is idempotent per (organization, source, externalRef)", async () => {
      const f = await fixture();
      await postBankRow(f, 1000, "in", "txn_dup");
      await expect(postBankRow(f, 1000, "in", "txn_dup")).rejects.toMatchObject({ code: "P2002" });
      expect(await db().journalEntry.count()).toBe(1);
    });

    it("tags revenue with a sales channel", async () => {
      const f = await fixture();
      const channel = await db().salesChannel.create({ data: { organizationId: f.orgId, kind: "SHOPIFY", name: "Shopify" } });
      const clearing = await db().$transaction((tx) => ensureClearingAccount(tx, f.orgId, "shopify_payments", "Shopify Payments"));
      const sales = await f.account("sales");
      const fees = await f.account("processor_fees");
      const entry = await postEntry(db(), {
        organizationId: f.orgId,
        date: "2026-09-02",
        source: EntrySource.ORDER,
        externalRef: "order_1001",
        lines: [
          { accountId: clearing.id, debitMinor: 9710, channelId: channel.id },
          { accountId: fees, debitMinor: 290, channelId: channel.id },
          { accountId: sales, creditMinor: 10000, channelId: channel.id },
        ],
      });
      expect(entry.lines.every((l) => l.channelId === channel.id)).toBe(true);
      expect(clearing.systemKey).toBe("clearing:shopify_payments");
    });
  });

  describe("database invariants (bypassing the service)", () => {
    it("refuses an unbalanced entry at commit even when written with raw Prisma", async () => {
      const f = await fixture();
      const cash = await f.account("cash");
      const sales = await f.account("sales");
      await expect(
        db().journalEntry.create({
          data: {
            organizationId: f.orgId,
            date: new Date("2026-09-01T00:00:00Z"),
            source: EntrySource.MANUAL,
            lines: {
              create: [
                { organizationId: f.orgId, accountId: cash, debitMinor: 500n, currency: "USD" },
                { organizationId: f.orgId, accountId: sales, creditMinor: 400n, currency: "USD" },
              ],
            },
          },
        }),
      ).rejects.toThrow(/does not balance/);
      expect(await db().journalEntry.count()).toBe(0);
    });

    it("refuses a line with both sides set or a negative amount", async () => {
      const f = await fixture();
      const cash = await f.account("cash");
      await expect(
        db().journalEntry.create({
          data: { organizationId: f.orgId, date: new Date("2026-09-01T00:00:00Z"), source: EntrySource.MANUAL, lines: { create: [{ organizationId: f.orgId, accountId: cash, debitMinor: 5n, creditMinor: 5n, currency: "USD" }, { organizationId: f.orgId, accountId: cash, debitMinor: -5n, currency: "USD" }] } },
        }),
      ).rejects.toThrow(/one_side_positive/);
    });

    it("blocks updates and deletes on locked entries and their lines", async () => {
      const f = await fixture();
      const entry = await postBankRow(f, 1000, "out");
      expect(await lockEntries(db(), f.orgId, [entry.id], { userId: f.userId })).toBe(1);

      await expect(db().journalEntry.update({ where: { id: entry.id }, data: { memo: "changed" } })).rejects.toThrow(/is locked/);
      await expect(db().journalEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/locked/);
      const line = entry.lines[1]!;
      await expect(db().journalLine.update({ where: { id: line.id }, data: { memo: "x" } })).rejects.toThrow(/is locked/);
      await expect(db().journalLine.delete({ where: { id: line.id } })).rejects.toThrow(/is locked/);
      expect(await lockEntries(db(), f.orgId, [entry.id])).toBe(0); // already locked → no-op
    });

    it("keeps bank-side lines and the entry date immutable once posted", async () => {
      const f = await fixture();
      const entry = await postBankRow(f, 1000, "in");
      const bank = entry.lines[0]!;
      await expect(db().journalLine.update({ where: { id: bank.id }, data: { debitMinor: 999n } })).rejects.toThrow(/immutable/);
      await expect(db().journalLine.delete({ where: { id: bank.id } })).rejects.toThrow(/cannot be deleted/);
      await expect(db().journalEntry.update({ where: { id: entry.id }, data: { date: new Date("2026-09-02T00:00:00Z") } })).rejects.toThrow(/cannot change/);
      await expect(db().journalEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/reverse it/);
    });
  });

  describe("recategorize", () => {
    it("re-points the offset in place, bumps the version, and audits before/after", async () => {
      const f = await fixture();
      const entry = await postBankRow(f, 4200, "out");
      const software = await f.account("software");
      const updated = await recategorizeEntry(db(), { organizationId: f.orgId, entryId: entry.id, expectedVersion: 1, offsets: [{ accountId: software, amountMinor: 4200 }], actor: { userId: f.userId } });
      expect(updated.version).toBe(2);
      expect(updated.lines).toHaveLength(2);
      expect(updated.lines[0]).toMatchObject({ isBankSide: true, creditMinor: 4200, id: entry.lines[0]!.id });
      expect(updated.lines[1]).toMatchObject({ accountId: software, debitMinor: 4200, position: 1 });

      const audit = await db().auditLog.findFirst({ where: { action: "entry.recategorize" } });
      expect(audit?.before).toMatchObject({ version: 1 });
      expect(audit?.after).toMatchObject({ version: 2 });
    });

    it("splits one bank row across several categories and channels", async () => {
      const f = await fixture();
      const entry = await postBankRow(f, 10000, "in");
      const sales = await f.account("sales");
      const other = await f.account("other_income");
      const channel = await db().salesChannel.create({ data: { organizationId: f.orgId, kind: "ETSY", name: "Etsy" } });
      const updated = await recategorizeEntry(db(), {
        organizationId: f.orgId,
        entryId: entry.id,
        expectedVersion: 1,
        offsets: [
          { accountId: sales, amountMinor: 7500, channelId: channel.id },
          { accountId: other, amountMinor: 2500 },
        ],
      });
      expect(updated.lines.map((l) => [l.accountId === sales ? "sales" : l.accountId === other ? "other" : "bank", l.debitMinor, l.creditMinor])).toEqual([
        ["bank", 10000, 0],
        ["sales", 0, 7500],
        ["other", 0, 2500],
      ]);
      expect(updated.lines[1]!.channelId).toBe(channel.id);
    });

    it("rejects offsets that do not sum to the bank line, stale versions, and locked entries", async () => {
      const f = await fixture();
      const entry = await postBankRow(f, 5000, "out");
      const rent = await f.account("rent");
      await expect(recategorizeEntry(db(), { organizationId: f.orgId, entryId: entry.id, expectedVersion: 1, offsets: [{ accountId: rent, amountMinor: 4999 }] })).rejects.toMatchObject({ code: "invalid_line" });
      await expect(recategorizeEntry(db(), { organizationId: f.orgId, entryId: entry.id, expectedVersion: 7, offsets: [{ accountId: rent, amountMinor: 5000 }] })).rejects.toMatchObject({ code: "stale_version" });
      await lockEntries(db(), f.orgId, [entry.id]);
      await expect(recategorizeEntry(db(), { organizationId: f.orgId, entryId: entry.id, expectedVersion: 1, offsets: [{ accountId: rent, amountMinor: 5000 }] })).rejects.toMatchObject({ code: "entry_locked" });
      // Nothing changed
      const same = await getEntry(db(), f.orgId, entry.id);
      expect(same.version).toBe(1);
      expect(same.lines[1]!.accountId).toBe(await f.account("uncategorized"));
    });

    it("is invisible across organizations", async () => {
      const a = await fixture();
      const b = await fixture();
      const entry = await postBankRow(a, 100, "out");
      const rentB = await b.account("rent");
      await expect(recategorizeEntry(db(), { organizationId: b.orgId, entryId: entry.id, expectedVersion: 1, offsets: [{ accountId: rentB, amountMinor: 100 }] })).rejects.toMatchObject({ code: "entry_not_found" });
    });
  });

  describe("reverse", () => {
    it("creates a mirror entry that nets to zero and marks the original REVERSED, even when locked", async () => {
      const f = await fixture();
      const entry = await postBankRow(f, 3000, "out");
      await lockEntries(db(), f.orgId, [entry.id]);
      const { original, reversal } = await reverseEntry(db(), { organizationId: f.orgId, entryId: entry.id, actor: { userId: f.userId } });
      expect(original.status).toBe("REVERSED");
      expect(reversal.reversesEntryId).toBe(entry.id);
      expect(reversal.lines.map((l) => [l.debitMinor, l.creditMinor])).toEqual([[3000, 0], [0, 3000]]);
      expect(reversal.date).toBe(entry.date);

      const tb = await trialBalance(db(), f.orgId);
      expect(tb.rows.every((r) => r.balanceMinor === 0)).toBe(true);
      expect(tb.totalDebitMinor).toBe(tb.totalCreditMinor);
      await expect(reverseEntry(db(), { organizationId: f.orgId, entryId: entry.id })).rejects.toMatchObject({ code: "invalid_transition" });
    });
  });

  describe("trial balance", () => {
    it("reports debit-normal and credit-normal balances as of a date", async () => {
      const f = await fixture();
      const cash = await f.account("cash");
      const sales = await f.account("sales");
      const rent = await f.account("rent");
      await postEntry(db(), { organizationId: f.orgId, date: "2026-08-15", source: EntrySource.MANUAL, lines: [{ accountId: cash, debitMinor: 50000 }, { accountId: sales, creditMinor: 50000 }] });
      await postEntry(db(), { organizationId: f.orgId, date: "2026-09-01", source: EntrySource.MANUAL, lines: [{ accountId: rent, debitMinor: 12000 }, { accountId: cash, creditMinor: 12000 }] });

      const august = await trialBalance(db(), f.orgId, "2026-08-31");
      expect(august.rows.find((r) => r.accountId === cash)?.balanceMinor).toBe(50000);
      expect(august.rows.find((r) => r.accountId === rent)?.balanceMinor).toBe(0);

      const all = await trialBalance(db(), f.orgId);
      expect(all.rows.find((r) => r.accountId === cash)?.balanceMinor).toBe(38000);
      expect(all.rows.find((r) => r.accountId === sales)?.balanceMinor).toBe(50000);
      expect(all.rows.find((r) => r.accountId === rent)?.balanceMinor).toBe(12000);
      expect(all.totalDebitMinor).toBe(all.totalCreditMinor);
      expect(all.totalDebitMinor).toBe(62000);
    });
  });
});
