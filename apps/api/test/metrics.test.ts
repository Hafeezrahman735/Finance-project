import request from "supertest";
import { describe, expect, it } from "vitest";
import { seedDemoOrg } from "../src/fixtures/demoOrg.js";
import { EntrySource, SalesChannelKind } from "../src/generated/prisma/enums.js";
import { ensureClearingAccount, systemAccount } from "../src/services/ledger/chart.js";
import { postEntryTx } from "../src/services/ledger/ledger.js";
import { displayFor, merchantSlug, metricsService, type MetricsView } from "../src/services/metrics/metrics.js";
import { auth, makeApp, signup } from "./helpers.js";
import { describePg, usePg } from "./pg.js";

const run = describePg() ? describe : describe.skip;

describe("metrics helpers", () => {
  it("formats every unit the way the brief will quote it", () => {
    expect(displayFor(871329, "minor", "USD")).toBe("$8,713.29");
    expect(displayFor(43.15, "percent", "USD")).toBe("43.1%");
    expect(displayFor(3.24, "ratio", "USD")).toBe("3.2x");
    expect(displayFor(34.6, "days", "USD")).toBe("35 days");
    expect(displayFor(1, "days", "USD")).toBe("1 day");
    expect(displayFor(9, "count", "USD")).toBe("9");
    expect(displayFor(null, "ratio", "USD")).toBe("n/a");
  });

  it("collapses merchant memos to one slug", () => {
    expect(merchantSlug("CANVA *1234 09/12")).toBe("canva");
    expect(merchantSlug("  canva  ")).toBe("canva");
    expect(merchantSlug("SHOPIFY PLAN #88")).toBe("shopify-plan");
    expect(merchantSlug("12345")).toBe("");
  });
});

run("metrics", () => {
  const db = usePg();
  const app = () => makeApp(db());
  const NOW = new Date("2026-09-12T18:00:00Z"); // 2026-09-12 in Chicago
  const byId = (view: MetricsView, id: string) => view.metrics.find((m) => m.id === id);

  it("computes cash, burn, runway, margin, ROAS, and per-channel numbers from a known ledger", async () => {
    const s = await signup(app());
    const org = s.organization.id;
    const svc = metricsService(db());
    await db().$transaction(async (tx) => {
      const id = (k: string) => systemAccount(tx, org, k).then((a) => a.id);
      const [cash, sales, fees, cogs, ads, rent, opening] = await Promise.all([id("cash"), id("sales"), id("processor_fees"), id("cogs"), id("advertising"), id("rent"), id("opening_balance")]);
      const stripe = (await ensureClearingAccount(tx, org, "stripe", "Stripe")).id;
      const tiktok = await tx.salesChannel.create({ data: { organizationId: org, kind: SalesChannelKind.TIKTOK_SHOP, name: "TikTok Shop" } });
      const post = (date: string, memo: string, lines: Parameters<typeof postEntryTx>[1]["lines"], source: EntrySource = EntrySource.BANK) =>
        postEntryTx(tx, { organizationId: org, date, memo, source, externalRef: `${memo}:${date}`, lines, actor: { userId: s.user.id } });
      await post("2026-06-01", "Opening", [{ accountId: cash, debitMinor: 100_000, isBankSide: true }, { accountId: opening, creditMinor: 100_000 }], EntrySource.OPENING);
      // Inside the 30-day window (Aug 14 – Sep 12): $1,000 revenue on TikTok, $50 fees, $400 COGS, $250 ads, $300 rent; one $800 payout.
      await post("2026-09-01", "TikTok orders", [{ accountId: stripe, debitMinor: 95_000, channelId: tiktok.id }, { accountId: fees, debitMinor: 5_000, channelId: tiktok.id }, { accountId: sales, creditMinor: 100_000, channelId: tiktok.id }], EntrySource.ORDER);
      await post("2026-09-02", "COGS", [{ accountId: cogs, debitMinor: 40_000, channelId: tiktok.id }, { accountId: cash, creditMinor: 40_000, isBankSide: true }]);
      await post("2026-09-03", "TIKTOK ADS", [{ accountId: ads, debitMinor: 25_000, channelId: tiktok.id }, { accountId: cash, creditMinor: 25_000, isBankSide: true }]);
      await post("2026-09-04", "RENT", [{ accountId: rent, debitMinor: 30_000 }, { accountId: cash, creditMinor: 30_000, isBankSide: true }]);
      await post("2026-09-05", "STRIPE TRANSFER", [{ accountId: cash, debitMinor: 80_000, isBankSide: true }, { accountId: stripe, creditMinor: 80_000 }]);
      // Previous window (Jul 15 – Aug 13): $500 revenue, no ads.
      await post("2026-08-01", "TikTok orders", [{ accountId: stripe, debitMinor: 48_000, channelId: tiktok.id }, { accountId: fees, debitMinor: 2_000, channelId: tiktok.id }, { accountId: sales, creditMinor: 50_000, channelId: tiktok.id }], EntrySource.ORDER);
    });

    const v = await svc.compute(org, "USD", "America/Chicago", NOW);
    expect(v.window).toEqual({ from: "2026-08-14", to: "2026-09-12" });
    expect(v.prevWindow).toEqual({ from: "2026-07-15", to: "2026-08-13" });
    // cash: 1000 - 400 - 250 - 300 + 800 = 850
    expect(byId(v, "cash_on_hand")).toMatchObject({ value: 85_000, display: "$850.00", unit: "minor" });
    expect(byId(v, "money_in_30d")!.value).toBe(80_000);
    expect(byId(v, "money_out_30d")!.value).toBe(95_000);
    expect(byId(v, "net_burn_30d")!.value).toBe(15_000);
    // runway = 850 / (150 / 30) = 170 days
    expect(byId(v, "runway_days")).toMatchObject({ value: 170, display: "170 days" });
    expect(byId(v, "revenue_30d")).toMatchObject({ value: 100_000, prev: { value: 50_000, display: "$500.00" } });
    expect(byId(v, "fee_rate_30d")).toMatchObject({ value: 5, display: "5.0%", prev: { value: 4 } });
    expect(byId(v, "gross_margin_30d")!.value).toBe(55_000); // 1000 - 50 - 400
    expect(byId(v, "gross_margin_pct_30d")!.display).toBe("55.0%");
    expect(byId(v, "roas_30d")).toMatchObject({ value: 4, display: "4.0x", prev: { value: null, display: "n/a" } });
    expect(byId(v, "contribution_margin_30d")!.value).toBe(30_000);
    expect(byId(v, "operating_expenses_30d")!.value).toBe(30_000);
    // channel metrics mirror the blended ones here (single channel)
    const ch = v.channels[0]!;
    expect(ch.name).toBe("TikTok Shop");
    expect(byId(v, `channel:${ch.id}:roas`)).toMatchObject({ value: 4, channelId: ch.id, label: "TikTok Shop ROAS" });
    expect(byId(v, `channel:${ch.id}:gross_margin_pct`)!.value).toBe(55);
    // clearing: 95 + 48 - 80 = 63 (sales minus fees minus payout)
    expect(v.processors).toHaveLength(1);
    expect(v.processors[0]).toMatchObject({ key: "stripe", name: "Stripe", balanceMinor: 63_000, lastPayoutDate: "2026-09-05", daysSinceLastPayout: 7 });
    expect(byId(v, "clearing:stripe:days_since_payout")!.display).toBe("7 days");
    expect(v.recurring).toEqual([]);
    expect(v.dataDays).toBe(6);
    expect(v.insufficientData).toBe(true);
    // every metric carries a display string and no NaN
    for (const m of v.metrics) {
      expect(typeof m.display).toBe("string");
      if (m.value !== null) expect(Number.isFinite(m.value)).toBe(true);
    }
  });

  it("runway is n/a when not burning, and the API caches a daily snapshot until the ledger changes", async () => {
    const s = await signup(app());
    const sales = (await request(app()).get("/api/v1/accounts").set(auth(s))).body.data.find((a: { systemKey: string }) => a.systemKey === "sales").id;
    await request(app()).post("/api/v1/transactions").set(auth(s)).send({ direction: "in", amountMinor: 5000, date: "2026-09-10", memo: "Sale", accountId: sales });

    const first = await request(app()).get("/api/v1/metrics").set(auth(s));
    expect(first.status).toBe(200);
    expect(first.body.metrics.find((m: { id: string }) => m.id === "runway_days")).toMatchObject({ value: null, display: "n/a" });
    expect(await db().metricsSnapshot.count({ where: { organizationId: s.organization.id } })).toBe(1);

    const again = await request(app()).get("/api/v1/metrics").set(auth(s));
    expect(again.body.computedAt).toBe(first.body.computedAt); // served from the snapshot

    await request(app()).post("/api/v1/transactions").set(auth(s)).send({ direction: "out", amountMinor: 1000, date: "2026-09-11", memo: "Coffee" });
    const after = await request(app()).get("/api/v1/metrics").set(auth(s));
    expect(after.body.computedAt).not.toBe(first.body.computedAt);
    expect(after.body.fingerprint).not.toBe(first.body.fingerprint);
    expect(after.body.metrics.find((m: { id: string }) => m.id === "uncategorized_count").value).toBe(1);
    expect(await db().metricsSnapshot.count({ where: { organizationId: s.organization.id } })).toBe(1);
  });

  it("finds the demo organization's planted anomalies: Canva jump, TikTok fee-rate drift, missing Stripe payout", async () => {
    const summary = await seedDemoOrg(db(), { today: "2026-09-12" });
    const v = await metricsService(db()).compute(summary.organizationId, "USD", "America/Chicago", NOW);
    expect(v.insufficientData).toBe(false);
    expect(v.dataDays).toBeGreaterThan(80);

    const canva = v.recurring.find((r) => r.slug === "canva")!;
    expect(canva).toMatchObject({ cadence: "monthly", amountMinor: 2999, prevAmountMinor: 1299 });
    expect(canva.deltaPct).toBeCloseTo(130.9, 0);
    expect(v.recurring.map((r) => r.slug).sort()).toEqual(["canva", "klaviyo", "shopify-plan", "transfer-to-owner"]);
    expect(byId(v, "recurring_monthly_total")!.value).toBe(7900 + 2999 + 4500 + 150000);

    const tiktok = v.channels.find((c) => c.name === "TikTok Shop")!;
    const feeRate = byId(v, `channel:${tiktok.id}:fee_rate`)!;
    // The jump (6% -> 8.1%) lands mid-window, so the 30-day rate is between; the drift vs the prior window is the signal.
    expect(feeRate.prev!.value).toBeCloseTo(6, 0);
    expect(feeRate.value! - feeRate.prev!.value!).toBeGreaterThan(1);
    const shopify = v.channels.find((c) => c.name === "Shopify")!;
    expect(byId(v, `channel:${shopify.id}:fee_rate`)!.value).toBeCloseTo(3, 0);

    const stripe = v.processors.find((p) => p.key === "stripe")!;
    expect(stripe.balanceMinor).toBeGreaterThan(0);
    expect(stripe.daysSinceLastPayout).toBeGreaterThanOrEqual(7);
    const shopifyPay = v.processors.find((p) => p.key === "shopify_payments")!;
    expect(shopifyPay.daysSinceLastPayout).toBeLessThan(7);

    expect(byId(v, "roas_30d")!.value).toBeGreaterThan(1);
    expect(byId(v, "gross_margin_pct_30d")!.value).toBeGreaterThan(40);
    expect(byId(v, "uncategorized_count")!.value).toBe(summary.uncategorized);
  });
});
