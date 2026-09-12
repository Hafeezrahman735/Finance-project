import request from "supertest";
import { describe, expect, it } from "vitest";
import { auth, makeApp, signup } from "./helpers.js";

const app = makeApp();
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

describe("dashboard", () => {
  it("returns zeros and empty lists for a new user", async () => {
    const { token } = await signup(app);
    const res = await request(app).get("/api/v1/dashboard").set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalBalance: 0, totalIncome: 0, totalExpense: 0 });
    expect(res.body.recentTransactions).toEqual([]);
    expect(res.body.last30DaysExpense).toEqual({ total: 0, transaction: [] });
  });

  it("aggregates totals, windows, and the merged recent feed per user only", async () => {
    const { token } = await signup(app);
    const other = await signup(app, "other@example.com");
    await request(app).post("/api/v1/income/addIncome").set(auth(other.token)).send({ source: "Noise", amount: 9999, date: daysAgo(1) });

    await request(app).post("/api/v1/income/addIncome").set(auth(token)).send({ source: "Old", amount: 100, date: daysAgo(90) });
    await request(app).post("/api/v1/income/addIncome").set(auth(token)).send({ source: "Recent", amount: 300, date: daysAgo(10) });
    await request(app).post("/api/v1/expense/addExpense").set(auth(token)).send({ category: "Rent", amount: 120, date: daysAgo(5) });
    await request(app).post("/api/v1/expense/addExpense").set(auth(token)).send({ category: "Old rent", amount: 50, date: daysAgo(45) });

    const res = await request(app).get("/api/v1/dashboard").set(auth(token));
    expect(res.body.totalIncome).toBe(400);
    expect(res.body.totalExpense).toBe(170);
    expect(res.body.totalBalance).toBe(230);
    expect(res.body.last60DaysIncome.total).toBe(300);
    expect(res.body.last30DaysExpense.total).toBe(120);
    expect(res.body.recentTransactions.map((t: { type: string; amount: number }) => [t.type, t.amount])).toEqual([
      ["expense", 120],
      ["income", 300],
      ["expense", 50],
      ["income", 100],
    ]);
  });
});
