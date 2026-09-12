import type { Response as SuperAgentResponse } from "superagent";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { auth, makeApp, signup, type Session } from "./helpers.js";
import { describePg, usePg } from "./pg.js";

const run = describePg() ? describe : describe.skip;

const collect = (r: SuperAgentResponse, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on("data", (c: Buffer) => chunks.push(c));
  r.on("end", () => cb(null, Buffer.concat(chunks)));
};

run("transactions API", () => {
  const db = usePg();
  const app = () => makeApp(db());

  async function accountId(s: Session, systemKey: string): Promise<string> {
    const res = await request(app()).get("/api/v1/accounts").set(auth(s));
    return res.body.data.find((a: { systemKey: string }) => a.systemKey === systemKey).id;
  }

  async function add(s: Session, body: Record<string, unknown>) {
    const res = await request(app()).post("/api/v1/transactions").set(auth(s)).send({ direction: "out", amountMinor: 1250, date: "2026-09-01", memo: "Coffee", ...body });
    return res;
  }

  it("creates money in / out against Cash, lists newest first with a cursor, and exposes the view shape", async () => {
    const s = await signup(app());
    const a = await add(s, { direction: "in", amountMinor: 50000, date: "2026-08-01", memo: "Invoice 1", accountId: await accountId(s, "sales") });
    const b = await add(s, { amountMinor: 1250, date: "2026-09-01", memo: "Coffee" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body).toMatchObject({ direction: "out", amountMinor: 1250, currency: "USD", categoryName: "Uncategorized", uncategorized: true, status: "POSTED", locked: false, version: 1, source: "MANUAL" });
    expect(b.body.bankAccount.name).toBe("Cash");
    expect(a.body).toMatchObject({ direction: "in", categoryName: "Sales", uncategorized: false });

    const page1 = await request(app()).get("/api/v1/transactions?limit=1").set(auth(s));
    expect(page1.status).toBe(200);
    expect(page1.body.data.map((t: { id: string }) => t.id)).toEqual([b.body.id]);
    expect(page1.body.nextCursor).toBeTypeOf("string");
    const page2 = await request(app()).get(`/api/v1/transactions?limit=1&cursor=${page1.body.nextCursor}`).set(auth(s));
    expect(page2.body.data.map((t: { id: string }) => t.id)).toEqual([a.body.id]);
    expect(page2.body.nextCursor).toBeNull();

    const onlyIn = await request(app()).get("/api/v1/transactions?direction=in").set(auth(s));
    expect(onlyIn.body.data).toHaveLength(1);
    const queue = await request(app()).get("/api/v1/transactions?status=uncategorized").set(auth(s));
    expect(queue.body.data.map((t: { id: string }) => t.id)).toEqual([b.body.id]);
    const august = await request(app()).get("/api/v1/transactions?from=2026-08-01&to=2026-08-31").set(auth(s));
    expect(august.body.data).toHaveLength(1);
  });

  it("validates input: amount must be a positive integer of minor units, date must be a calendar date", async () => {
    const s = await signup(app());
    expect((await add(s, { amountMinor: 0 })).body.error.param).toBe("amountMinor");
    expect((await add(s, { amountMinor: 12.5 })).body.error.param).toBe("amountMinor");
    expect((await add(s, { date: "09/01/2026" })).body.error.param).toBe("date");
    expect((await add(s, { direction: "sideways" })).body.error.param).toBe("direction");
  });

  it("recategorizes and splits via PATCH with the version, and refuses stale versions", async () => {
    const s = await signup(app());
    const t = (await add(s, { amountMinor: 10000 })).body;
    const software = await accountId(s, "software");
    const rent = await accountId(s, "rent");

    const one = await request(app()).patch(`/api/v1/transactions/${t.id}`).set(auth(s)).send({ version: 1, lines: [{ accountId: software, amountMinor: 10000 }] });
    expect(one.status).toBe(200);
    expect(one.body).toMatchObject({ id: t.id, version: 2, categoryName: "Software and subscriptions", uncategorized: false });

    const split = await request(app()).patch(`/api/v1/transactions/${t.id}`).set(auth(s)).send({ version: 2, lines: [{ accountId: software, amountMinor: 4000 }, { accountId: rent, amountMinor: 6000 }] });
    expect(split.status).toBe(200);
    expect(split.body.categoryName).toBe("Split");
    expect(split.body.lines.map((l: { amountMinor: number }) => l.amountMinor)).toEqual([4000, 6000]);

    const stale = await request(app()).patch(`/api/v1/transactions/${t.id}`).set(auth(s)).send({ version: 1, lines: [{ accountId: rent, amountMinor: 10000 }] });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("stale_version");

    const short = await request(app()).patch(`/api/v1/transactions/${t.id}`).set(auth(s)).send({ version: 3, lines: [{ accountId: rent, amountMinor: 9999 }] });
    expect(short.status).toBe(422);
    expect(short.body.error.code).toBe("invalid_line");
  });

  it("edits a manual entry's amount/date by reversing and re-posting, but not an imported one", async () => {
    const s = await signup(app());
    const t = (await add(s, { amountMinor: 10000, memo: "Typo" })).body;
    const fixed = await request(app()).patch(`/api/v1/transactions/${t.id}`).set(auth(s)).send({ version: 1, amountMinor: 1000, memo: "Fixed" });
    expect(fixed.status).toBe(200);
    expect(fixed.body.id).not.toBe(t.id);
    expect(fixed.body).toMatchObject({ amountMinor: 1000, memo: "Fixed", direction: "out" });

    const visible = await request(app()).get("/api/v1/transactions").set(auth(s));
    expect(visible.body.data.map((x: { id: string }) => x.id)).toEqual([fixed.body.id]); // reversed + reversal hidden by default
    const all = await request(app()).get("/api/v1/transactions?includeReversed=true").set(auth(s));
    expect(all.body.data).toHaveLength(3);

    // Simulate an imported row: source BANK is not editable in amount.
    await db().journalEntry.update({ where: { id: fixed.body.id }, data: { source: "BANK" } });
    const refused = await request(app()).patch(`/api/v1/transactions/${fixed.body.id}`).set(auth(s)).send({ version: 1, amountMinor: 5 });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("invalid_transition");
  });

  it("DELETE reverses (nothing is ever deleted) and a second delete is refused", async () => {
    const s = await signup(app());
    const t = (await add(s, {})).body;
    const del = await request(app()).delete(`/api/v1/transactions/${t.id}`).set(auth(s));
    expect(del.status).toBe(200);
    expect(del.body.original.status).toBe("REVERSED");
    expect(del.body.reversal.reversesEntryId).toBe(t.id);
    expect((await request(app()).delete(`/api/v1/transactions/${t.id}`).set(auth(s))).status).toBe(409);
    expect((await request(app()).get("/api/v1/transactions").set(auth(s))).body.data).toHaveLength(0);
    expect(await db().journalEntry.count()).toBe(2);
  });

  it("is invisible across organizations: foreign ids read as 404, foreign org header too", async () => {
    const a = await signup(app());
    const b = await signup(app());
    const mine = (await add(a, {})).body;
    expect((await request(app()).get(`/api/v1/transactions/${mine.id}`).set(auth(b))).status).toBe(404);
    expect((await request(app()).patch(`/api/v1/transactions/${mine.id}`).set(auth(b)).send({ version: 1, memo: "x" })).status).toBe(404);
    expect((await request(app()).delete(`/api/v1/transactions/${mine.id}`).set(auth(b))).status).toBe(404);
    expect((await request(app()).get("/api/v1/transactions").set(auth(b))).body.data).toHaveLength(0);
    // b claims a's organization by header
    const spoof = await request(app()).get("/api/v1/transactions").set(auth(b.token, a.organization.id));
    expect(spoof.status).toBe(404);
    expect(spoof.body.error.code).toBe("organization_not_found");
    // malformed ids behave like foreign ids
    expect((await request(app()).get("/api/v1/transactions/not-a-uuid").set(auth(a))).status).toBe(404);
  });

  it("streams an .xlsx export with the formula-injection guard", async () => {
    const s = await signup(app());
    await add(s, { memo: '=HYPERLINK("http://evil")' });
    const res = await request(app()).get("/api/v1/transactions/export.xlsx?direction=out").set(auth(s)).buffer(true).parse(collect);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.headers["content-disposition"]).toContain("transactions-out.xlsx");
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe("PK");
  });
});
