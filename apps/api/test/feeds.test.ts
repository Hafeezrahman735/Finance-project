import request from "supertest";
import { describe, expect, it } from "vitest";
import { BankAccountKind, BankConnectionStatus, EntryStatus } from "../src/generated/prisma/enums.js";
import { createSecrets, deriveDevKey, keyIdOf, parseKey, Secrets, SecretsError } from "../src/lib/secrets.js";
import { defaultFixtureItem, FixtureProvider, FIXTURE_PUBLIC_TOKEN, fromPlaidTransaction, plaidKind, type FeedTransaction, type FixtureItem } from "../src/services/banking/feedProvider.js";
import { feedsService } from "../src/services/banking/feeds.js";
import { auth, makeApp, signup, testConfig } from "./helpers.js";
import { describePg, usePg } from "./pg.js";

const run = describePg() ? describe : describe.skip;

const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);

describe("secrets at rest", () => {
  it("seals and opens with AES-256-GCM, names the key, and refuses the wrong key or tampering", () => {
    const s = new Secrets(parseKey(KEY_A));
    const sealed = s.seal("access-sandbox-123");
    expect(sealed.keyId).toBe(keyIdOf(parseKey(KEY_A)));
    expect(sealed.ciphertext).not.toContain("access-sandbox");
    expect(s.open(sealed)).toBe("access-sandbox-123");
    expect(s.seal("x").ciphertext).not.toBe(s.seal("x").ciphertext); // fresh iv every time
    const other = new Secrets(parseKey(KEY_B));
    expect(() => other.open(sealed)).toThrow(SecretsError);
    const buf = Buffer.from(sealed.ciphertext, "base64");
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff;
    expect(() => s.open({ ...sealed, ciphertext: buf.toString("base64") })).toThrow(/authentication/);
  });

  it("rotates: a previous key still opens, and the row is flagged for re-sealing", () => {
    const before = new Secrets(parseKey(KEY_A));
    const sealed = before.seal("tok");
    const after = new Secrets(parseKey(KEY_B), [parseKey(KEY_A)]);
    expect(after.open(sealed)).toBe("tok");
    expect(after.needsRotation(sealed)).toBe(true);
    expect(after.needsRotation(after.seal("tok"))).toBe(false);
    expect(() => new Secrets(parseKey(KEY_B)).open(sealed)).toThrow(/TOKEN_ENCRYPTION_KEY_PREVIOUS/);
  });

  it("derives a development key from JWT_SECRET when no key is configured, with a warning", () => {
    const warnings: string[] = [];
    const s = createSecrets({ JWT_SECRET: "test-secret-at-least-16-chars" }, (m) => warnings.push(m));
    expect(warnings[0]).toMatch(/TOKEN_ENCRYPTION_KEY not set/);
    expect(s.currentKeyId).toBe(keyIdOf(deriveDevKey("test-secret-at-least-16-chars")));
    expect(() => parseKey("short")).toThrow(/64 hex/);
  });
});

describe("plaid mapping", () => {
  it("flips Plaid's sign (positive = money out) and maps account kinds", () => {
    const t = fromPlaidTransaction({ transaction_id: "t1", account_id: "a1", amount: 12.34, iso_currency_code: "USD", date: "2026-09-10", name: "COFFEE", merchant_name: "Blue Bottle", pending: false, pending_transaction_id: null } as never);
    expect(t).toMatchObject({ externalId: "t1", amountMinor: -1234, description: "Blue Bottle", pending: false, pendingExternalId: null });
    expect(fromPlaidTransaction({ transaction_id: "t2", account_id: "a1", amount: -500, date: "2026-09-10", name: "DEPOSIT", pending: true } as never).amountMinor).toBe(50_000);
    expect(plaidKind("credit", "credit card")).toBe(BankAccountKind.CREDIT_CARD);
    expect(plaidKind("depository", "savings")).toBe(BankAccountKind.SAVINGS);
    expect(plaidKind("depository", "checking")).toBe(BankAccountKind.CHECKING);
    expect(plaidKind("loan", "mortgage")).toBe(BankAccountKind.OTHER);
  });
});

// ---------------------------------------------------------------------------

run("bank feeds", () => {
  const db = usePg();
  const actor = { userId: null };
  const CHK = "chk";
  const tx = (id: string, daysAgoDate: string, amountMinor: number, description: string, extra: Partial<FeedTransaction> = {}): FeedTransaction => ({
    externalId: id,
    accountExternalId: CHK,
    date: daysAgoDate,
    amountMinor,
    description,
    pending: false,
    pendingExternalId: null,
    raw: { id },
    ...extra,
  });
  const item = (steps: FixtureItem["steps"]): FixtureItem => ({ institutionName: "Scripted Bank", accounts: [{ externalId: CHK, name: "Checking", mask: "1111", kind: BankAccountKind.CHECKING }], steps });

  async function setup(steps: FixtureItem["steps"]) {
    const provider = new FixtureProvider();
    const app = makeApp(db(), {}, { feedProvider: provider });
    const s = await signup(app);
    const feeds = feedsService(db(), { provider, secrets: createSecrets(testConfig) });
    const publicToken = provider.register(item(steps));
    return { provider, app, s, feeds, publicToken };
  }

  const liveEntries = (orgId: string) => db().journalEntry.findMany({ where: { organizationId: orgId, status: EntryStatus.POSTED, reversesEntryId: null, source: "BANK" }, include: { lines: true }, orderBy: { date: "asc" } });

  it("connects: seals the token, creates one bank account per feed account, and posts the first pages with rules applied", async () => {
    const { app, s, feeds, publicToken } = await setup([
      { added: [tx("t1", "2026-09-01", 50_000, "STRIPE TRANSFER"), tx("t2", "2026-09-02", -1_299, "CANVA")], modified: [], removed: [], nextCursor: "1", hasMore: true },
      { added: [tx("t3", "2026-09-03", -2_500, "PIRATE SHIP")], modified: [], removed: [], nextCursor: "2", hasMore: false },
    ]);
    const software = (await request(app).get("/api/v1/accounts").set(auth(s))).body.data.find((a: { systemKey: string }) => a.systemKey === "software").id;
    await request(app).post("/api/v1/rules").set(auth(s)).send({ pattern: "CANVA", match: "CONTAINS", accountId: software });

    const { connection, sync } = await feeds.connect(s.organization.id, "USD", { publicToken, institutionName: "Scripted Bank" }, actor);
    expect(sync).toMatchObject({ pages: 2, added: 3, modified: 0, removed: 0, skipped: 0, restarts: 0, status: "ACTIVE" });
    expect(connection.accounts).toHaveLength(1);
    expect(connection.accounts[0]).toMatchObject({ name: "Scripted Bank Checking", mask: "1111" });
    expect(connection.transactionCount).toBe(3);
    const row = await db().bankConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(row.accessTokenCiphertext).not.toContain("fixture-access");
    expect(row.syncCursor).toBe("2");
    expect(row.lastSyncedAt).not.toBeNull();

    const entries = await liveEntries(s.organization.id);
    expect(entries).toHaveLength(3);
    const canva = entries.find((e) => e.memo === "CANVA")!;
    expect(canva.lines.find((l) => !l.isBankSide)!.accountId).toBe(software); // rule applied
    expect(canva.externalRef).toBe("fixture:t2:0");
    const stripe = entries.find((e) => e.memo === "STRIPE TRANSFER")!;
    expect(Number(stripe.lines.find((l) => l.isBankSide)!.debitMinor)).toBe(50_000);
    // the bank account's ledger account carries the balance: 500 - 12.99 - 25
    const dash = await request(app).get("/api/v1/dashboard").set(auth(s));
    expect(dash.body.cashOnHandMinor).toBe(50_000 - 1_299 - 2_500);
  });

  it("is idempotent: re-syncing from an earlier cursor posts nothing twice", async () => {
    const { s, feeds, publicToken } = await setup([{ added: [tx("t1", "2026-09-01", 1_000, "A"), tx("t2", "2026-09-01", -2_000, "B")], modified: [], removed: [], nextCursor: "1", hasMore: false }]);
    const { connection } = await feeds.connect(s.organization.id, "USD", { publicToken }, actor);
    await db().bankConnection.update({ where: { id: connection.id }, data: { syncCursor: null } }); // pretend the cursor was lost
    const again = await feeds.sync(s.organization.id, connection.id, actor);
    expect(again).toMatchObject({ added: 0, modified: 0, removed: 0 });
    expect(await liveEntries(s.organization.id)).toHaveLength(2);
    expect(await db().bankTransaction.count({ where: { connectionId: connection.id } })).toBe(2);
  });

  it("commits page by page: a provider failure on page 2 keeps page 1 and its cursor; the next sync resumes", async () => {
    const { s, feeds, publicToken } = await setup([
      { added: [tx("t1", "2026-09-01", 1_000, "A")], modified: [], removed: [], nextCursor: "1", hasMore: true },
      { error: "OTHER", message: "boom" },
      { added: [tx("t2", "2026-09-02", 2_000, "B")], modified: [], removed: [], nextCursor: "3", hasMore: false },
    ]);
    await expect(feeds.connect(s.organization.id, "USD", { publicToken }, actor)).rejects.toMatchObject({ code: "feed_other", status: 502 });
    const conn = await db().bankConnection.findFirstOrThrow({ where: { organizationId: s.organization.id } });
    expect(conn.syncCursor).toBe("1");
    expect(conn.lastError).toMatch(/boom/);
    expect(await liveEntries(s.organization.id)).toHaveLength(1);
    const resumed = await feeds.sync(s.organization.id, conn.id, actor);
    expect(resumed).toMatchObject({ added: 1, pages: 1 });
    expect(await liveEntries(s.organization.id)).toHaveLength(2);
    expect((await db().bankConnection.findUniqueOrThrow({ where: { id: conn.id } })).lastError).toBeNull();
  });

  it("restarts from the saved cursor on MUTATION_DURING_PAGINATION and flags NEEDS_REAUTH on ITEM_LOGIN_REQUIRED", async () => {
    const { s, feeds, publicToken } = await setup([
      { added: [tx("t1", "2026-09-01", 1_000, "A")], modified: [], removed: [], nextCursor: "1", hasMore: true },
      { error: "MUTATION_DURING_PAGINATION" },
      { added: [tx("t2", "2026-09-02", 2_000, "B")], modified: [], removed: [], nextCursor: "3", hasMore: false },
      { error: "ITEM_LOGIN_REQUIRED", message: "the bank wants a fresh login" },
    ]);
    const { sync, connection } = await feeds.connect(s.organization.id, "USD", { publicToken }, actor);
    expect(sync).toMatchObject({ restarts: 1, added: 2, pages: 2, status: "ACTIVE" });
    const reauth = await feeds.sync(s.organization.id, connection.id, actor);
    expect(reauth.status).toBe(BankConnectionStatus.NEEDS_REAUTH);
    expect((await feeds.get(s.organization.id, connection.id)).lastError).toMatch(/fresh login/);
    // reconnecting clears the flag and syncs (nothing new)
    const back = await feeds.reconnected(s.organization.id, connection.id, actor);
    expect(back.status).toBe("ACTIVE");
  });

  it("modified rows are reversed and re-posted keeping the category; removed rows are reversed; pending→posted inherits the category", async () => {
    const { app, s, feeds, publicToken } = await setup([
      {
        added: [tx("coffee", "2026-09-03", -1_275, "BLUE BOTTLE"), tx("pend", "2026-09-05", -8_899, "AMAZON", { pending: true }), tx("gone", "2026-09-04", -500, "FEE")],
        modified: [],
        removed: [],
        nextCursor: "1",
        hasMore: false,
      },
      {
        added: [tx("posted", "2026-09-06", -8_899, "AMAZON", { pendingExternalId: "pend" })],
        modified: [tx("coffee", "2026-09-03", -1_425, "BLUE BOTTLE")],
        removed: [{ externalId: "pend" }, { externalId: "gone" }],
        nextCursor: "2",
        hasMore: false,
      },
    ]);
    const { connection } = await feeds.connect(s.organization.id, "USD", { publicToken }, actor);
    // The user categorizes the pending Amazon row and the coffee before the bank updates them.
    const accounts = (await request(app).get("/api/v1/accounts").set(auth(s))).body.data;
    const office = accounts.find((a: { systemKey: string }) => a.systemKey === "office").id;
    const meals = accounts.find((a: { systemKey: string }) => a.systemKey === "meals").id;
    const list = (await request(app).get("/api/v1/transactions?status=all&limit=50").set(auth(s))).body.data;
    const pendingTxn = list.find((t: { memo: string }) => t.memo === "AMAZON");
    const coffeeTxn = list.find((t: { memo: string }) => t.memo === "BLUE BOTTLE");
    await request(app).patch(`/api/v1/transactions/${pendingTxn.id}`).set(auth(s)).send({ version: pendingTxn.version, lines: [{ accountId: office, amountMinor: 8_899 }] });
    await request(app).patch(`/api/v1/transactions/${coffeeTxn.id}`).set(auth(s)).send({ version: coffeeTxn.version, lines: [{ accountId: meals, amountMinor: 1_275 }] });

    const second = await feeds.sync(s.organization.id, connection.id, actor);
    expect(second).toMatchObject({ added: 1, modified: 1, removed: 2 });

    const live = await liveEntries(s.organization.id);
    expect(live.map((e) => e.memo).sort()).toEqual(["AMAZON", "BLUE BOTTLE"]);
    const amazon = live.find((e) => e.memo === "AMAZON")!;
    expect(amazon.externalRef).toBe("fixture:posted:0");
    expect(amazon.lines.find((l) => !l.isBankSide)!.accountId).toBe(office); // inherited from the pending row
    const coffee = live.find((e) => e.memo === "BLUE BOTTLE")!;
    expect(coffee.externalRef).toBe("fixture:coffee:1");
    expect(Number(coffee.lines.find((l) => l.isBankSide)!.creditMinor)).toBe(1_425);
    expect(coffee.lines.find((l) => !l.isBankSide)!.accountId).toBe(meals); // category kept across the re-post

    // the old entries are REVERSED with mirror entries, so the trial balance still holds and history is visible
    const reversed = await db().journalEntry.count({ where: { organizationId: s.organization.id, status: EntryStatus.REVERSED } });
    expect(reversed).toBe(3); // pending amazon, old coffee, fee
    const rows = await db().bankTransaction.findMany({ where: { connectionId: connection.id }, orderBy: { externalId: "asc" } });
    expect(rows.map((r) => `${r.externalId}:${r.status}:${r.revision}`)).toEqual(["coffee:ACTIVE:1", "gone:REMOVED:0", "pend:REMOVED:0", "posted:ACTIVE:0"]);
    // a third sync is a no-op
    expect(await feeds.sync(s.organization.id, connection.id, actor)).toMatchObject({ added: 0, modified: 0, removed: 0 });
  });

  it("rows for an unknown account are skipped, not posted; the token re-seals after a key rotation", async () => {
    const { provider, s, feeds, publicToken } = await setup([{ added: [tx("t1", "2026-09-01", 1_000, "A"), tx("t2", "2026-09-01", 1_000, "B", { accountExternalId: "mystery" })], modified: [], removed: [], nextCursor: "1", hasMore: false }]);
    const { sync, connection } = await feeds.connect(s.organization.id, "USD", { publicToken }, actor);
    expect(sync).toMatchObject({ added: 1, skipped: 1 });

    const before = await db().bankConnection.findUniqueOrThrow({ where: { id: connection.id } });
    // Same provider instance (it holds the fixture item), new key ring: KEY_B current, the old key kept as previous.
    const rotated = feedsService(db(), { provider, secrets: createSecrets({ ...testConfig, TOKEN_ENCRYPTION_KEY: KEY_B, TOKEN_ENCRYPTION_KEY_PREVIOUS: testConfig.TOKEN_ENCRYPTION_KEY }) });
    expect(await rotated.sync(s.organization.id, connection.id, actor)).toMatchObject({ added: 0 });
    const after = await db().bankConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(after.keyId).toBe(keyIdOf(parseKey(KEY_B)));
    expect(after.keyId).not.toBe(before.keyId);
    expect(after.accessTokenCiphertext).not.toBe(before.accessTokenCiphertext);
    // and the old key ring can no longer open it
    await expect(feeds.sync(s.organization.id, connection.id, actor)).rejects.toThrow(/TOKEN_ENCRYPTION_KEY_PREVIOUS/);
  });

  it("routes: provider info, link token, connect with the default fixture bank, list, sync, disconnect; foreign ids are 404", async () => {
    const app = makeApp(db());
    const s = await signup(app);
    expect((await request(app).get("/api/v1/bank-connections/provider").set(auth(s))).body).toEqual({ name: "fixture", env: "fixture" });
    expect((await request(app).post("/api/v1/bank-connections/link-token").set(auth(s))).body).toMatchObject({ linkToken: "fixture-link-token", provider: "fixture", updateMode: false });

    const connected = await request(app).post("/api/v1/bank-connections").set(auth(s)).send({ publicToken: FIXTURE_PUBLIC_TOKEN });
    expect(connected.status).toBe(201);
    expect(connected.body.connection.institutionName).toBe("Fixture Bank");
    expect(connected.body.connection.accounts.map((a: { kind: string }) => a.kind).sort()).toEqual(["CHECKING", "CREDIT_CARD"]);
    const fixture = defaultFixtureItem();
    const expected = (fixture.steps[0] as { added: unknown[] }).added.length + (fixture.steps[1] as { added: unknown[] }).added.length;
    expect(connected.body.sync).toMatchObject({ pages: 2, added: expected });

    const list = await request(app).get("/api/v1/bank-connections").set(auth(s));
    expect(list.body.data).toHaveLength(1);
    const id = list.body.data[0].id;
    // second sync: the pending Amazon posts, the coffee changes
    const synced = await request(app).post(`/api/v1/bank-connections/${id}/sync`).set(auth(s));
    expect(synced.body).toMatchObject({ added: 1, modified: 1, removed: 1 });
    const other = await signup(app);
    expect((await request(app).post(`/api/v1/bank-connections/${id}/sync`).set(auth(other))).status).toBe(404);

    const gone = await request(app).delete(`/api/v1/bank-connections/${id}`).set(auth(s));
    expect(gone.status).toBe(200);
    expect((await request(app).get("/api/v1/bank-connections").set(auth(s))).body.data).toEqual([]);
    expect((await request(app).post(`/api/v1/bank-connections/${id}/sync`).set(auth(s))).body.error.code).toBe("bank_connection_disconnected");
    // history stays
    expect((await request(app).get("/api/v1/bank-accounts").set(auth(s))).body.data).toHaveLength(2);
  });
});
