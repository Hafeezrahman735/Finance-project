import type { Response as SuperAgentResponse } from "superagent";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { auth, makeApp, signup } from "./helpers.js";

const app = makeApp();

const kinds = [
  {
    kind: "income",
    label: "source",
    add: "/api/v1/income/addIncome",
    list: "/api/v1/income/getIncome",
    excel: "/api/v1/income/downloadexcel",
    update: (id: string) => `/api/v1/income/updateIncome/${id}`,
    del: (id: string) => `/api/v1/income/${id}`,
    delLegacy: (id: string) => `/api/v1/income/delete/${id}`,
  },
  {
    kind: "expense",
    label: "category",
    add: "/api/v1/expense/addExpense",
    list: "/api/v1/expense/get",
    excel: "/api/v1/expense/downloadExcel",
    update: (id: string) => `/api/v1/expense/updateExpense/${id}`,
    del: (id: string) => `/api/v1/expense/${id}`,
    delLegacy: null,
  },
] as const;

const collect = (r: SuperAgentResponse, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on("data", (c: Buffer) => chunks.push(c));
  r.on("end", () => cb(null, Buffer.concat(chunks)));
};

describe.each(kinds)("$kind", (k) => {
  const payload = (over: Record<string, unknown> = {}) => ({ [k.label]: "Consulting", amount: 1250.5, date: "2026-09-01", icon: "briefcase", ...over });

  it("creates, lists (newest first), updates, and deletes for the owner", async () => {
    const { token } = await signup(app);
    const a = await request(app).post(k.add).set(auth(token)).send(payload({ date: "2026-08-01" }));
    const b = await request(app).post(k.add).set(auth(token)).send(payload({ date: "2026-09-01" }));
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const list = await request(app).get(k.list).set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body.map((r: { _id: string }) => r._id)).toEqual([b.body._id, a.body._id]);

    const upd = await request(app).patch(k.update(a.body._id)).set(auth(token)).send({ amount: 99 });
    expect(upd.status).toBe(200);
    expect(upd.body.amount).toBe(99);

    const del = await request(app).delete(k.del(a.body._id)).set(auth(token));
    expect(del.status).toBe(200);
    expect((await request(app).get(k.list).set(auth(token))).body).toHaveLength(1);
  });

  it("validates input: missing label, non-positive amount, bad date", async () => {
    const { token } = await signup(app);
    const missing = await request(app).post(k.add).set(auth(token)).send(payload({ [k.label]: "" }));
    expect(missing.status).toBe(400);
    expect(missing.body.error.param).toBe(k.label);
    const zero = await request(app).post(k.add).set(auth(token)).send(payload({ amount: 0 }));
    expect(zero.status).toBe(400);
    expect(zero.body.error.param).toBe("amount");
    const badDate = await request(app).post(k.add).set(auth(token)).send(payload({ date: "not-a-date" }));
    expect(badDate.status).toBe(400);
    expect(badDate.body.error.param).toBe("date");
  });

  it("another user cannot read, update, or delete my rows (IDOR fixed)", async () => {
    const owner = await signup(app, "owner@example.com");
    const other = await signup(app, "other@example.com");
    const mine = await request(app).post(k.add).set(auth(owner.token)).send(payload());

    expect((await request(app).get(k.list).set(auth(other.token))).body).toHaveLength(0);
    const upd = await request(app).patch(k.update(mine.body._id)).set(auth(other.token)).send({ amount: 1 });
    expect(upd.status).toBe(404);
    const del = await request(app).delete(k.del(mine.body._id)).set(auth(other.token));
    expect(del.status).toBe(404);

    const still = await request(app).get(k.list).set(auth(owner.token));
    expect(still.body[0].amount).toBe(1250.5);
  });

  it("requires auth on every route", async () => {
    const id = "000000000000000000000000";
    const calls = [
      request(app).post(k.add).send({}),
      request(app).get(k.list),
      request(app).patch(k.update(id)).send({}),
      request(app).delete(k.del(id)),
      request(app).get(k.excel),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
  });

  it("streams an .xlsx export with the formula-injection guard", async () => {
    const { token } = await signup(app);
    await request(app).post(k.add).set(auth(token)).send(payload({ [k.label]: '=HYPERLINK("http://evil")' }));
    const res = await request(app).get(k.excel).set(auth(token)).buffer(true).parse(collect);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.headers["content-disposition"]).toContain(".xlsx");
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe("PK");
  });

  if (k.delLegacy) {
    const legacy = k.delLegacy;
    it("keeps the legacy /income/delete/:id path working", async () => {
      const { token } = await signup(app);
      const row = await request(app).post(k.add).set(auth(token)).send(payload());
      const del = await request(app).delete(legacy(row.body._id)).set(auth(token));
      expect(del.status).toBe(200);
    });
  }
});
