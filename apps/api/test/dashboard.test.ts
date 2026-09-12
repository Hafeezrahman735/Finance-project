import request from "supertest";
import { describe, expect, it } from "vitest";
import { seedDemoOrg } from "../src/fixtures/demoOrg.js";
import { dashboardService } from "../src/services/dashboard/dashboard.js";
import { auth, makeApp, signup } from "./helpers.js";
import { describePg, usePg } from "./pg.js";

const run = describePg() ? describe : describe.skip;

run("dashboard", () => {
  const db = usePg();
  const app = () => makeApp(db());

  it("returns zeros for a fresh organization", async () => {
    const s = await signup(app());
    const res = await request(app()).get("/api/v1/dashboard").set(auth(s));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ currency: "USD", timezone: "America/Chicago", totalBalanceMinor: 0, totalIncomeMinor: 0, totalExpenseMinor: 0, cashOnHandMinor: 0, uncategorizedCount: 0 });
    expect(res.body.recentTransactions).toEqual([]);
    expect(res.body.last30Days.transactions).toEqual([]);
  });

  it("aggregates from the ledger with calendar-date windows in the org timezone", async () => {
    const s = await signup(app());
    const sales = (await request(app()).get("/api/v1/accounts").set(auth(s))).body.data.find((a: { systemKey: string }) => a.systemKey === "sales").id;
    const post = (body: Record<string, unknown>) => request(app()).post("/api/v1/transactions").set(auth(s)).send(body);
    // "now" is 2026-09-12 01:00 UTC = 2026-09-11 20:00 in Chicago, so "today" must be the 11th.
    const now = new Date("2026-09-12T01:00:00Z");
    await post({ direction: "in", amountMinor: 30000, date: "2026-09-11", memo: "Today", accountId: sales });
    await post({ direction: "in", amountMinor: 10000, date: "2026-08-13", memo: "Day 30", accountId: sales }); // inside the 30-day window (Aug 13..Sep 11)
    await post({ direction: "in", amountMinor: 5000, date: "2026-08-12", memo: "Day 31", accountId: sales }); // outside 30, inside 60
    await post({ direction: "out", amountMinor: 12000, date: "2026-09-01", memo: "Rent" });
    await post({ direction: "out", amountMinor: 4500, date: "2026-06-01", memo: "Old" });

    const view = await dashboardService(db()).get(s.organization.id, "USD", "America/Chicago", now);
    expect(view.today).toBe("2026-09-11");
    expect(view.last30Days).toMatchObject({ from: "2026-08-13", to: "2026-09-11", incomeMinor: 40000, expenseMinor: 12000 });
    expect(view.last60DaysIncome).toMatchObject({ from: "2026-07-14", totalMinor: 45000 });
    expect(view.totalIncomeMinor).toBe(45000);
    expect(view.totalExpenseMinor).toBe(16500);
    expect(view.totalBalanceMinor).toBe(28500);
    expect(view.cashOnHandMinor).toBe(28500);
    expect(view.uncategorizedCount).toBe(2);
    expect(view.recentTransactions.map((t) => t.memo)).toEqual(["Today", "Rent", "Day 30", "Day 31", "Old"]);
    expect(view.last30Days.daily).toHaveLength(30);
    expect(view.last30Days.daily[0]).toEqual({ date: "2026-08-13", inMinor: 10000, outMinor: 0 });
    expect(view.last30Days.daily.at(-1)).toEqual({ date: "2026-09-11", inMinor: 30000, outMinor: 0 });
    expect(view.last30Days.daily.find((d) => d.date === "2026-09-01")).toEqual({ date: "2026-09-01", inMinor: 0, outMinor: 12000 });
  });

  it("works on the demo organization and keeps cash equal to the ledger", async () => {
    const summary = await seedDemoOrg(db(), { today: "2026-09-12" });
    const view = await dashboardService(db()).get(summary.organizationId, "USD", "America/Chicago", new Date("2026-09-12T18:00:00Z"));
    expect(view.uncategorizedCount).toBe(summary.uncategorized);
    expect(view.totalIncomeMinor).toBeGreaterThan(0);
    expect(view.cashOnHandMinor).toBeGreaterThan(0);
    expect(view.recentTransactions).toHaveLength(5);
  });
});
