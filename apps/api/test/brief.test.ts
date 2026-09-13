import request from "supertest";
import { describe, expect, it } from "vitest";
import { seedDemoOrg } from "../src/fixtures/demoOrg.js";
import { detectAnomalies } from "../src/services/ai/anomalies.js";
import { briefService, renderBriefText, toBriefInput } from "../src/services/ai/brief.js";
import { fallbackBrief } from "../src/services/ai/fallback.js";
import { displayValues, parseNumberToken, validateBrief } from "../src/services/ai/grounding.js";
import { buildUserPrompt, cassetteKey, ModelUnavailableError, safeParseBrief, type BriefModel, type ModelResult } from "../src/services/ai/model.js";
import { DISCLAIMER, type BriefInput, type MoneyBrief } from "../src/services/ai/schema.js";
import { CapturingEmailSink } from "../src/services/email/email.js";
import { metricsService, type MetricsView } from "../src/services/metrics/metrics.js";
import { auth, makeApp, signup } from "./helpers.js";
import { describePg, usePg } from "./pg.js";

const run = describePg() ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const W = { from: "2026-08-14", to: "2026-09-12" };
const input: BriefInput = {
  organizationName: "Sunny Side Studio",
  currency: "USD",
  periodStart: "2026-09-07",
  periodEnd: "2026-09-13",
  asOf: "2026-09-12",
  window: { from: "2026-08-14", to: "2026-09-12" },
  prevWindow: { from: "2026-07-15", to: "2026-08-13" },
  dataDays: 88,
  metrics: [
    { id: "cash_on_hand", label: "Cash on hand", display: "$8,535.70", window: null },
    { id: "revenue_30d", label: "Revenue", display: "$4,121.07", window: W, prev: "$3,300.00" },
    { id: "gross_margin_30d", label: "Gross margin", display: "$2,350.46", window: W, prev: "$1,744.39" },
    { id: "gross_margin_pct_30d", label: "Gross margin rate", display: "57.0%", window: W, prev: "52.9%" },
    { id: "ad_spend_30d", label: "Ad spend", display: "$1,361.41", window: W },
    { id: "roas_30d", label: "Blended ROAS", display: "3.0x", window: W, prev: "2.7x" },
    { id: "runway_days", label: "Runway", display: "165 days", window: W },
    { id: "recurring:canva:amount", label: "CANVA (monthly)", display: "$29.99", window: null, prev: "$12.99" },
    { id: "recurring:canva:delta_pct", label: "CANVA change", display: "130.9%", window: null },
    { id: "clearing:stripe:days_since_payout", label: "Days since last Stripe payout", display: "9 days", window: null, note: "Last payout 2026-09-03." },
  ],
  anomalies: [
    { id: "recurring_jump:canva", kind: "recurring_jump", severity: "high", message: "CANVA charged $29.99, up 130.9% from $12.99.", metricIds: ["recurring:canva:amount", "recurring:canva:delta_pct"], suggestedAction: "Check the CANVA plan." },
  ],
};

const goodBrief: MoneyBrief = {
  headline: "You kept $2,350.46 of $4,121.07 in sales: 57.0% gross margin, up from 52.9%.",
  warm_line: "Solid month; one subscription needs a look.",
  findings: [
    { claim: "CANVA charged $29.99, up 130.9% from $12.99.", evidence_metric_ids: ["recurring:canva:amount", "recurring:canva:delta_pct"], severity: "high" },
    { claim: "Ads returned 3.0x on $1,361.41, better than 2.7x the month before.", evidence_metric_ids: ["roas_30d", "ad_spend_30d"], severity: "info" },
  ],
  suggested_actions: [{ action: "Check the CANVA plan and downgrade if the jump was not intended.", reason: "It more than doubled to $29.99.", confidence: "high" }],
  disclaimer: DISCLAIMER,
};

/** Scripted model: each call pops the next result; records prompts it saw. */
class FakeModel implements BriefModel {
  readonly provider = "recorded" as const;
  readonly prompts: string[] = [];
  constructor(private readonly script: (ModelResult | Error)[]) {}
  async generate(inp: BriefInput, feedback?: string): Promise<ModelResult> {
    this.prompts.push(buildUserPrompt(inp, feedback));
    const next = this.script.shift();
    if (!next) throw new ModelUnavailableError("FakeModel: script exhausted");
    if (next instanceof Error) throw next;
    return next;
  }
}
const ok = (brief: MoneyBrief): ModelResult => ({ brief, raw: JSON.stringify(brief), model: "claude-opus-5" });

// ---------------------------------------------------------------------------

describe("grounding validator", () => {
  it("parses money, percent, ratio, and K/M tokens", () => {
    expect(parseNumberToken("$8,535.70")).toEqual({ value: 8535.7, approximate: false, integer: false });
    expect(parseNumberToken("57.0%")).toMatchObject({ value: 57 });
    expect(parseNumberToken("3.0x")).toMatchObject({ value: 3 });
    expect(parseNumberToken("$8.5K")).toMatchObject({ value: 8500, approximate: true });
    expect(parseNumberToken("2M")).toMatchObject({ value: 2_000_000, approximate: true });
    expect(displayValues("165 days")).toEqual([165]);
    expect(displayValues("Last payout 2026-09-03.")).toEqual([2026, 9, 3]); // raw tokens; dates are stripped before matching
  });

  it("accepts a grounded brief, including rounded and approximate forms of input numbers", () => {
    expect(validateBrief(goodBrief, input)).toEqual({ ok: true, errors: [] });
    const rounded = { ...goodBrief, headline: "Cash on hand is $8,536, about $8.5K, after a 30 day window." };
    expect(validateBrief(rounded, input).ok).toBe(true);
    const dated = { ...goodBrief, warm_line: "The last Stripe payout landed on Sep 3, 2026 and on 2026-09-03." };
    expect(validateBrief(dated, input).ok).toBe(true);
  });

  it("rejects fabricated or derived numbers, unknown metric ids, links, and markdown", () => {
    const derived = { ...goodBrief, headline: "Gross margin grew by $606.07 this month." };
    expect(validateBrief(derived, input).errors).toEqual(['headline: "$606.07" is not a number from the input']);
    const madeUp = { ...goodBrief, findings: [{ ...goodBrief.findings[0]!, claim: "Revenue was about $4,200." }] };
    expect(validateBrief(madeUp, input).errors[0]).toMatch(/"\$4,200" is not a number/);
    const badId = { ...goodBrief, findings: [{ ...goodBrief.findings[0]!, evidence_metric_ids: ["revenue_30d", "nope"] }] };
    expect(validateBrief(badId, input).errors).toEqual(['findings[0]: unknown metric id "nope"']);
    const link = { ...goodBrief, suggested_actions: [{ ...goodBrief.suggested_actions[0]!, action: "See https://evil.example for details." }] };
    expect(validateBrief(link, input).errors).toEqual(["suggested_actions[0].action: contains a link"]);
    const md = { ...goodBrief, warm_line: "**Great** month" };
    expect(validateBrief(md, input).errors).toEqual(["warm_line: contains markdown or HTML"]);
  });

  it("safeParseBrief enforces the schema; cassette keys change with the prompt", () => {
    expect(safeParseBrief("not json")).toBeNull();
    expect(safeParseBrief(JSON.stringify({ headline: "x" }))).toBeNull();
    expect(safeParseBrief(JSON.stringify(goodBrief))).toEqual(goodBrief);
    expect(cassetteKey(input)).toHaveLength(24);
    expect(cassetteKey(input)).not.toBe(cassetteKey(input, "fix the number"));
    expect(cassetteKey(input)).toBe(cassetteKey({ ...input }));
  });
});

describe("anomaly rules and fallback", () => {
  const m = (id: string, label: string, value: number | null, unit: "minor" | "percent" | "ratio" | "days" | "count", display: string, prev?: { value: number | null; display: string }, channelId?: string) => ({ id, label, value, unit, display, window: null, ...(prev ? { prev } : {}), ...(channelId ? { channelId } : {}) });
  const view: MetricsView = {
    organizationId: "o", currency: "USD", timezone: "America/Chicago", asOf: "2026-09-12", computedAt: "", fingerprint: "v1",
    window: { from: "2026-08-14", to: "2026-09-12" }, prevWindow: { from: "2026-07-15", to: "2026-08-13" }, dataDays: 60, insufficientData: false,
    channels: [{ id: "c1", name: "TikTok Shop", kind: "TIKTOK_SHOP" }],
    recurring: [{ slug: "canva", memo: "CANVA", cadence: "monthly", amountMinor: 2999, prevAmountMinor: 1299, deltaPct: 130.9, lastDate: "2026-09-06", occurrences: 3 }],
    processors: [{ key: "stripe", name: "Stripe", accountId: "a", balanceMinor: 59692, lastPayoutDate: "2026-09-01", daysSinceLastPayout: 11 }],
    metrics: [
      m("cash_on_hand", "Cash on hand", 200000, "minor", "$2,000.00"),
      m("money_in_30d", "Money in", 300000, "minor", "$3,000.00"),
      m("money_out_30d", "Money out", 420000, "minor", "$4,200.00"),
      m("net_burn_30d", "Net cash burn", 120000, "minor", "$1,200.00", { value: 50000, display: "$500.00" }),
      m("runway_days", "Runway", 50, "days", "50 days"),
      m("revenue_30d", "Revenue", 412107, "minor", "$4,121.07"),
      m("gross_margin_30d", "Gross margin", 235046, "minor", "$2,350.46"),
      m("gross_margin_pct_30d", "Gross margin rate", 57, "percent", "57.0%"),
      m("ad_spend_30d", "Ad spend", 136141, "minor", "$1,361.41"),
      m("roas_30d", "Blended ROAS", 3, "ratio", "3.0x"),
      m("uncategorized_count", "Transactions needing a category", 12, "count", "12"),
      m("uncategorized_30d", "Uncategorized spend", 1000, "minor", "$10.00"),
      m("recurring:canva:amount", "CANVA (monthly)", 2999, "minor", "$29.99", { value: 1299, display: "$12.99" }),
      m("recurring:canva:delta_pct", "CANVA change vs previous charge", 130.9, "percent", "130.9%"),
      m("clearing:stripe:balance", "Stripe awaiting payout", 59692, "minor", "$596.92"),
      m("clearing:stripe:days_since_payout", "Days since last Stripe payout", 11, "days", "11 days"),
      m("channel:c1:revenue", "TikTok Shop revenue", 100000, "minor", "$1,000.00", undefined, "c1"),
      m("channel:c1:fees", "TikTok Shop processor fees", 8100, "minor", "$81.00", undefined, "c1"),
      m("channel:c1:fee_rate", "TikTok Shop fee rate", 8.1, "percent", "8.1%", { value: 6, display: "6.0%" }, "c1"),
      m("channel:c1:cogs", "TikTok Shop COGS", 41000, "minor", "$410.00", undefined, "c1"),
      m("channel:c1:gross_margin", "TikTok Shop gross margin", -5000, "minor", "-$50.00", undefined, "c1"),
      m("channel:c1:ad_spend", "TikTok Shop ad spend", 60000, "minor", "$600.00", undefined, "c1"),
      m("channel:c1:roas", "TikTok Shop ROAS", 1.7, "ratio", "1.7x", { value: 2.6, display: "2.6x" }, "c1"),
    ],
  };

  it("fires every rule the fixture plants, ordered by severity, with sentences made only of display strings", () => {
    const anomalies = detectAnomalies(view);
    expect(anomalies.map((a) => a.id)).toEqual([
      "recurring_jump:canva",
      "payout_missing:stripe",
      "margin_negative:c1",
      "low_runway",
      "fee_rate_drift:c1",
      "roas_drop:c1",
      "burn_up",
      "uncategorized_backlog",
    ]);
    expect(anomalies[0]!.message).toBe("CANVA charged $29.99, up 130.9% from $12.99.");
    expect(anomalies[1]!.message).toBe("$596.92 earned through Stripe has not been deposited; the last payout was 11 days ago.");
    expect(anomalies[4]!.message).toBe("TikTok Shop fees rose to 8.1% of revenue from 6.0%.");
    // every anomaly's evidence exists and every sentence grounds
    const inp = toBriefInput({ id: "o", name: "Org", currency: "USD", timezone: "America/Chicago" }, view, anomalies, "2026-09-07", "2026-09-13");
    const ids = new Set(inp.metrics.map((x) => x.id));
    for (const a of anomalies) for (const id of a.metricIds) expect(ids.has(id), id).toBe(true);
  });

  it("the fallback brief leads with margin, uses the anomalies, and passes the same validator", () => {
    const anomalies = detectAnomalies(view);
    const brief = fallbackBrief(view, anomalies);
    expect(brief.headline).toBe("You kept $2,350.46 of $4,121.07 in sales after refunds, fees, and COGS: 57.0% gross margin, with $1,361.41 in ads returning 3.0x.");
    expect(brief.findings).toHaveLength(5);
    expect(brief.suggested_actions[0]!.action).toMatch(/CANVA/);
    const inp = toBriefInput({ id: "o", name: "Org", currency: "USD", timezone: "America/Chicago" }, view, anomalies, "2026-09-07", "2026-09-13");
    expect(validateBrief(brief, inp)).toEqual({ ok: true, errors: [] });
    // nothing to report
    const quiet = { ...view, recurring: [], processors: [], channels: [], metrics: view.metrics.filter((x) => ["cash_on_hand", "revenue_30d", "gross_margin_30d", "gross_margin_pct_30d"].includes(x.id)) };
    const q = fallbackBrief(quiet, detectAnomalies(quiet));
    expect(q.findings[0]!.claim).toMatch(/Nothing unusual/);
    expect(q.suggested_actions[0]!.action).toBe("Nothing to do this week.");
  });
});

// ---------------------------------------------------------------------------

run("weekly brief service", () => {
  const db = usePg();
  const NOW = new Date("2026-09-12T18:00:00Z"); // Saturday 2026-09-12 in Chicago → week of Monday 2026-09-07
  const org = (s: { organization: { id: string; name: string; currency: string; timezone: string } }) => ({ ...s.organization });
  const svc = (model: BriefModel, email = new CapturingEmailSink()) => briefService(db(), { metrics: metricsService(db()), model, email, appUrl: "http://localhost:5173" });

  it("stores a GENERATED brief with its input snapshot and raw response; the second read is served, not regenerated", async () => {
    const summary = await seedDemoOrg(db(), { today: "2026-09-12" });
    const o = { id: summary.organizationId, name: "Sunny Side Studio", currency: "USD", timezone: "America/Chicago" };
    // Build a grounded answer from the real input so numbers match.
    const view = await metricsService(db()).get(o.id, "USD", o.timezone, NOW);
    const anomalies = detectAnomalies(view);
    const real = fallbackBrief(view, anomalies);
    const narrated: MoneyBrief = { ...real, headline: `Margin first: ${real.headline}`, warm_line: "Nice work this week." };
    const model = new FakeModel([ok(narrated)]);
    const s = svc(model);

    const first = await s.current(o, NOW);
    expect(first).not.toBeNull();
    expect(first!.status).toBe("GENERATED");
    expect(first!.periodStart).toBe("2026-09-07");
    expect(first!.periodEnd).toBe("2026-09-13");
    expect(first!.brief.headline).toMatch(/^Margin first:/);
    expect(first!.firstOpen).toBe(true);
    expect(first!.anomalies.map((a) => a.kind)).toContain("recurring_jump");
    expect(first!.metrics["cash_on_hand"]!.display).toMatch(/^\$/);
    expect(model.prompts).toHaveLength(1);
    expect(model.prompts[0]).toContain("recurring_jump:canva");

    const again = await s.current(o, NOW);
    expect(again!.id).toBe(first!.id);
    expect(again!.firstOpen).toBe(false);
    expect(model.prompts).toHaveLength(1);

    const row = await db().aiInsight.findUniqueOrThrow({ where: { id: first!.id } });
    expect(row.rawResponse).toBe(JSON.stringify(narrated));
    expect((row.inputSnapshot as unknown as BriefInput).metrics.length).toBeGreaterThan(20);
    expect(row.model).toBe("claude-opus-5");
  });

  it("retries once with the validator's feedback, then degrades to the deterministic summary", async () => {
    const summary = await seedDemoOrg(db(), { today: "2026-09-12" });
    const o = { id: summary.organizationId, name: "Sunny Side Studio", currency: "USD", timezone: "America/Chicago" };
    const bad = { ...goodBrief, headline: "Revenue rose to $9,999.99 this month." };
    const model = new FakeModel([ok(bad), ok(bad)]);
    const s = svc(model);
    const dto = await s.generate(o, NOW);
    expect(dto.status).toBe("DEGRADED");
    expect(dto.degradedReason).toMatch(/^grounding: headline: "\$9,999.99" is not a number/);
    expect(model.prompts).toHaveLength(2);
    expect(model.prompts[1]).toMatch(/rejected by the validator/);
    expect(dto.brief.headline).toMatch(/^You kept/); // fallback
    expect(dto.model).toBe("claude-opus-5");
  });

  it("degrades cleanly on refusal, on model-off, and on insufficient data (no model call at all)", async () => {
    const summary = await seedDemoOrg(db(), { today: "2026-09-12" });
    const o = { id: summary.organizationId, name: "Sunny Side Studio", currency: "USD", timezone: "America/Chicago" };
    const refused = await svc(new FakeModel([{ brief: null, raw: "", model: "claude-opus-5", failure: "refused" }])).generate(o, NOW);
    expect(refused).toMatchObject({ status: "DEGRADED", degradedReason: "refused" });

    const off = await svc(new FakeModel([])).generate(o, NOW, { regenerate: true });
    expect(off.status).toBe("DEGRADED");
    expect(off.degradedReason).toMatch(/script exhausted|model_unavailable/);

    const fresh = await signup(makeApp(db()));
    const model = new FakeModel([ok(goodBrief)]);
    const thin = await svc(model).generate(org(fresh), NOW);
    expect(thin).toMatchObject({ status: "DEGRADED", degradedReason: "insufficient_data", insufficientData: true });
    expect(model.prompts).toHaveLength(0);
  });

  it("caps regeneration per week and emails verified owners once", async () => {
    const summary = await seedDemoOrg(db(), { today: "2026-09-12" });
    const o = { id: summary.organizationId, name: "Sunny Side Studio", currency: "USD", timezone: "America/Chicago" };
    const email = new CapturingEmailSink();
    const s = svc(new FakeModel([]), email); // model off: every brief is the deterministic summary
    const first = await s.generate(o, NOW);
    for (let i = 0; i < 3; i++) await s.generate(o, NOW, { regenerate: true });
    await expect(s.generate(o, NOW, { regenerate: true })).rejects.toMatchObject({ code: "brief_regeneration_limit", status: 429 });

    expect(await s.emailBrief(o, first.id)).toBe(0); // demo owner is not verified
    await db().user.update({ where: { id: summary.userId }, data: { emailVerifiedAt: new Date() } });
    expect(await s.emailBrief(o, first.id)).toBe(1);
    expect(email.sent[0]!.subject).toMatch(/Money Brief for the week of 2026-09-07/);
    expect(email.sent[0]!.text).toContain(first.brief.headline);
    expect(email.sent[0]!.text).toContain("http://localhost:5173/brief");
    const run1 = await s.runWeekly(NOW);
    expect(run1.emailed).toBe(0); // already emailed
  });

  it("renders the email text without blank-line runs and marks degraded briefs", () => {
    const dto = { id: "x", periodStart: "2026-09-07", periodEnd: "2026-09-13", asOf: "2026-09-12", status: "DEGRADED" as const, model: null, degradedReason: "insufficient_data", brief: goodBrief, anomalies: [], metrics: {}, insufficientData: true, dataDays: 3, firstOpen: false, regenerations: 0, createdAt: "" };
    const text = renderBriefText({ id: "o", name: "Org", currency: "USD", timezone: "UTC" }, dto, "http://app");
    expect(text).toContain("AI narration unavailable this week");
    expect(text).not.toMatch(/\n\n\n/);
  });
});

run("brief routes", () => {
  const db = usePg();

  it("GET /briefs/current generates on first read, lists, fetches by id, and 404s foreign ids; the flag switches it off", async () => {
    const app = makeApp(db(), {}, { briefModel: new FakeModel([]) });
    const s = await signup(app);
    const first = await request(app).get("/api/v1/briefs/current").set(auth(s));
    expect(first.status).toBe(200);
    expect(first.body.enabled).toBe(true);
    expect(first.body.brief.status).toBe("DEGRADED");
    expect(first.body.brief.insufficientData).toBe(true);
    expect(first.body.brief.firstOpen).toBe(true);
    const list = await request(app).get("/api/v1/briefs").set(auth(s));
    expect(list.body.data).toHaveLength(1);
    const one = await request(app).get(`/api/v1/briefs/${first.body.brief.id}`).set(auth(s));
    expect(one.body.brief.firstOpen).toBe(false);
    const other = await signup(app);
    expect((await request(app).get(`/api/v1/briefs/${first.body.brief.id}`).set(auth(other))).status).toBe(404);

    await db().organization.update({ where: { id: s.organization.id }, data: { featureFlags: { moneyBrief: false } } });
    const off = await request(app).get("/api/v1/briefs/current").set(auth(s));
    expect(off.body).toEqual({ enabled: false, brief: null });
    expect((await request(app).post("/api/v1/briefs/current/email").set(auth(s))).body.error.code).toBe("brief_disabled");
  });
});
