import request from "supertest";
import { describe, expect, it } from "vitest";
import { auth, makeApp, signup, type Session } from "./helpers.js";
import { describePg, usePg } from "./pg.js";

const run = describePg() ? describe : describe.skip;

const STATEMENT = [
  "﻿Posting Date,Description,Amount,Running Bal.",
  "09/01/2026,\"COFFEE, DOWNTOWN\",-4.50,\"1,000.00\"",
  "09/01/2026,\"COFFEE, DOWNTOWN\",-4.50,995.50",
  "09/02/2026,SHOPIFY PAYOUT 88213,472.00,\"1,467.50\"",
  "09/03/2026,PIRATE SHIP,(30.80),\"1,436.70\"",
  "09/04/2026,,12.00,",
  "not a date,BAD ROW,1.00,",
].join("\r\n");

run("CSV import", () => {
  const db = usePg();
  const app = () => makeApp(db());

  async function bankAccount(s: Session, name = "Checking") {
    const res = await request(app()).post("/api/v1/bank-accounts").set(auth(s)).send({ name, kind: "CHECKING", mask: "4321" });
    expect(res.status).toBe(201);
    return res.body as { id: string; accountId: string };
  }

  async function upload(s: Session, bankAccountId: string, text = STATEMENT, filename = "statement.csv") {
    return request(app()).post("/api/v1/imports").set(auth(s)).field("bankAccountId", bankAccountId).attach("file", Buffer.from(text, "utf8"), filename);
  }

  it("creates a bank account with its own ledger account and counts it as cash on hand", async () => {
    const s = await signup(app());
    const b = await bankAccount(s);
    const acct = await db().account.findUnique({ where: { id: b.accountId } });
    expect(acct).toMatchObject({ type: "ASSET", name: "Checking", systemKey: `bank:${b.id}` });
    const dup = await request(app()).post("/api/v1/bank-accounts").set(auth(s)).send({ name: "Checking" });
    expect(dup.status).toBe(409);
    const card = await request(app()).post("/api/v1/bank-accounts").set(auth(s)).send({ name: "Visa", kind: "CREDIT_CARD" });
    expect((await db().account.findUnique({ where: { id: card.body.accountId } }))?.type).toBe("LIABILITY");
  });

  it("uploads, guesses the mapping with evidence, previews new/duplicate/invalid, and commits with rules applied", async () => {
    const s = await signup(app());
    const b = await bankAccount(s);
    const shipping = (await request(app()).get("/api/v1/accounts").set(auth(s))).body.data.find((a: { systemKey: string }) => a.systemKey === "shipping").id;
    await request(app()).post("/api/v1/rules").set(auth(s)).send({ pattern: "pirate ship", accountId: shipping, applyToExisting: false });

    const up = await upload(s, b.id);
    expect(up.status).toBe(201);
    expect(up.body.import).toMatchObject({ status: "UPLOADED", rowCount: 6, filename: "statement.csv" });
    expect(up.body.import.columns).toEqual(["Posting Date", "Description", "Amount", "Running Bal."]);
    expect(up.body.guess.mapping).toMatchObject({ dateColumn: "Posting Date", descriptionColumn: "Description", amountColumn: "Amount", dateFormat: "MDY" });
    expect(up.body.guess.evidence["Description"]).toEqual(["COFFEE, DOWNTOWN", "COFFEE, DOWNTOWN", "SHOPIFY PAYOUT 88213"]);

    const mapped = await request(app()).post(`/api/v1/imports/${up.body.import.id}/mapping`).set(auth(s)).send(up.body.guess.mapping);
    expect(mapped.status).toBe(200);
    expect(mapped.body.import).toMatchObject({ status: "MAPPED", newCount: 4, duplicateCount: 0, invalidCount: 2 });
    expect(mapped.body.preview.invalidRows.map((r: { problem: string }) => r.problem)).toEqual([expect.stringMatching(/no description/), expect.stringMatching(/no date/)]);
    expect(mapped.body.preview.newRows.map((r: { amountMinor: number }) => r.amountMinor)).toEqual([-450, -450, 47200, -3080]);

    const committed = await request(app()).post(`/api/v1/imports/${up.body.import.id}/commit`).set(auth(s)).send({});
    expect(committed.status).toBe(200);
    expect(committed.body).toMatchObject({ status: "COMMITTED", importedCount: 4 });

    const list = await request(app()).get("/api/v1/transactions").set(auth(s));
    expect(list.body.data).toHaveLength(4);
    const byMemo = Object.fromEntries(list.body.data.map((t: { memo: string; categoryName: string; direction: string; amountMinor: number; source: string; bankAccount: { id: string } }) => [t.memo, t]));
    expect(byMemo["PIRATE SHIP"]).toMatchObject({ categoryName: "Shipping and fulfillment", direction: "out", amountMinor: 3080, source: "BANK" });
    expect(byMemo["SHOPIFY PAYOUT 88213"]).toMatchObject({ categoryName: "Uncategorized", direction: "in", amountMinor: 47200 });
    expect(byMemo["COFFEE, DOWNTOWN"].bankAccount.id).toBe(b.accountId);
    expect((await request(app()).get("/api/v1/rules").set(auth(s))).body.data[0].hitCount).toBe(1);

    // Committing again is a no-op.
    expect((await request(app()).post(`/api/v1/imports/${up.body.import.id}/commit`).set(auth(s)).send({})).body.importedCount).toBe(4);
  });

  it("marks a re-upload as duplicates, lets the user un-skip one, and the database refuses a true double post", async () => {
    const s = await signup(app());
    const b = await bankAccount(s);
    const first = await upload(s, b.id);
    await request(app()).post(`/api/v1/imports/${first.body.import.id}/mapping`).set(auth(s)).send(first.body.guess.mapping);
    await request(app()).post(`/api/v1/imports/${first.body.import.id}/commit`).set(auth(s)).send({});

    const second = await upload(s, b.id);
    const mapped = await request(app()).post(`/api/v1/imports/${second.body.import.id}/mapping`).set(auth(s)).send(second.body.guess.mapping);
    expect(mapped.body.import).toMatchObject({ newCount: 0, duplicateCount: 4, invalidCount: 2 });
    expect(mapped.body.preview.duplicateRows).toHaveLength(4);

    // Un-skip the payout row: it gets the same dedupe hash, so the unique externalRef stops it.
    const payoutIndex = mapped.body.preview.duplicateRows.find((r: { description: string }) => r.description.startsWith("SHOPIFY")).index;
    const commit = await request(app()).post(`/api/v1/imports/${second.body.import.id}/commit`).set(auth(s)).send({ includeDuplicates: [payoutIndex] });
    expect(commit.status).toBe(500);
    const failed = await request(app()).get(`/api/v1/imports/${second.body.import.id}`).set(auth(s));
    expect(failed.body.status).toBe("FAILED");
    expect(failed.body.error).toMatch(/Unique constraint|unique/i);
    expect((await request(app()).get("/api/v1/transactions").set(auth(s))).body.data).toHaveLength(4);
  });

  it("supports debit/credit pairs, a different bank account, and DMY dates", async () => {
    const s = await signup(app());
    const b = await bankAccount(s, "Business Savings");
    const text = "Date;Details;Debit;Credit\n13/09/2026;Rent;1200,00;\n14/09/2026;Client A;;500\n";
    const up = await upload(s, b.id, text, "bank.csv");
    expect(up.body.guess.mapping).toMatchObject({ debitColumn: "Debit", creditColumn: "Credit", dateFormat: "DMY" });
    const mapped = await request(app()).post(`/api/v1/imports/${up.body.import.id}/mapping`).set(auth(s)).send(up.body.guess.mapping);
    // "1200,00" is a decimal comma: rejected rather than read as 120000 (shared money rules).
    expect(mapped.body.import).toMatchObject({ newCount: 1, invalidCount: 1 });
    expect(mapped.body.preview.invalidRows[0].problem).toMatch(/neither "Debit" nor "Credit"/);
    await request(app()).post(`/api/v1/imports/${up.body.import.id}/commit`).set(auth(s)).send({});
    const t = (await request(app()).get("/api/v1/transactions").set(auth(s))).body.data[0];
    expect(t).toMatchObject({ memo: "Client A", direction: "in", amountMinor: 50000, date: "2026-09-14" });
  });

  it("rejects non-statements, oversize files, and foreign bank accounts", async () => {
    const s = await signup(app());
    const b = await bankAccount(s);
    const one = await upload(s, b.id, "just one column\nvalue\n", "x.csv");
    expect(one.status).toBe(400);
    expect(one.body.error.param).toBe("file");
    expect(one.body.message).toMatch(/doesn't look like a statement \(found 1 column\)/);
    const empty = await upload(s, b.id, "Date,Description,Amount\n", "empty.csv");
    expect(empty.body.message).toMatch(/header but no rows/);
    const big = await upload(s, b.id, "Date,Description,Amount\n" + "x".repeat(11 * 1024 * 1024), "big.csv");
    expect(big.status).toBe(400);
    expect(big.body.error.code).toBe("file_too_large");
    const other = await signup(app());
    const foreign = await upload(other, b.id);
    expect(foreign.status).toBe(404);
    const noFile = await request(app()).post("/api/v1/imports").set(auth(s)).field("bankAccountId", b.id);
    expect(noFile.status).toBe(400);
    expect(noFile.body.error.param).toBe("file");
  });

  it("rules: create with apply-to-existing recategorizes matching uncategorized rows; bad regex rejected; delete archives", async () => {
    const s = await signup(app());
    const software = (await request(app()).get("/api/v1/accounts").set(auth(s))).body.data.find((a: { systemKey: string }) => a.systemKey === "software").id;
    for (const memo of ["CANVA PTY", "canva", "NETFLIX"]) {
      await request(app()).post("/api/v1/transactions").set(auth(s)).send({ direction: "out", amountMinor: 1299, date: "2026-09-01", memo });
    }
    const bad = await request(app()).post("/api/v1/rules").set(auth(s)).send({ pattern: "(", match: "REGEX", accountId: software });
    expect(bad.status).toBe(400);
    const created = await request(app()).post("/api/v1/rules").set(auth(s)).send({ pattern: "Canva", accountId: software });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ applied: 2, rule: { accountName: "Software and subscriptions", hitCount: 2 } });
    const queue = await request(app()).get("/api/v1/transactions?status=uncategorized").set(auth(s));
    expect(queue.body.data.map((t: { memo: string }) => t.memo)).toEqual(["NETFLIX"]);
    const del = await request(app()).delete(`/api/v1/rules/${created.body.rule.id}`).set(auth(s));
    expect(del.status).toBe(200);
    expect((await request(app()).get("/api/v1/rules").set(auth(s))).body.data).toHaveLength(0);
  });
});
