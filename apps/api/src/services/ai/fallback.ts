import type { MetricsView } from "../metrics/metrics.js";
import { DISCLAIMER, type Anomaly, type MoneyBrief } from "./schema.js";

/**
 * Deterministic summary (CEO 2.1): what the reader sees when the model is
 * off, refused, or failed grounding twice. Built only from metric display
 * strings and anomaly sentences, so it passes the same validator.
 */
export function fallbackBrief(view: MetricsView, anomalies: Anomaly[]): MoneyBrief {
  const m = (id: string) => view.metrics.find((x) => x.id === id);
  const revenue = m("revenue_30d");
  const gm = m("gross_margin_30d");
  const gmPct = m("gross_margin_pct_30d");
  const ads = m("ad_spend_30d");
  const roas = m("roas_30d");
  const cash = m("cash_on_hand");
  const burn = m("net_burn_30d");

  let headline: string;
  if (revenue && revenue.value && gm && gmPct?.value !== null && gmPct?.value !== undefined) {
    headline = `You kept ${gm.display} of ${revenue.display} in sales after refunds, fees, and COGS: ${gmPct.display} gross margin`;
    if (ads && ads.value && roas?.value !== null && roas?.value !== undefined) headline += `, with ${ads.display} in ads returning ${roas.display}`;
    headline += ".";
  } else if (burn && burn.value !== null && cash) {
    headline = burn.value > 0 ? `${burn.display} more left the bank than came in over the last 30 days; cash on hand is ${cash.display}.` : `Deposits covered what went out over the last 30 days; cash on hand is ${cash.display}.`;
  } else {
    headline = "Not enough activity yet to say much; import a statement and this brief fills in.";
  }

  const findings: MoneyBrief["findings"] = anomalies.slice(0, 5).map((a) => ({ claim: a.message, evidence_metric_ids: a.metricIds, severity: a.severity }));
  if (findings.length === 0) {
    findings.push({
      claim: cash ? `Nothing unusual this week. Cash on hand is ${cash.display}.` : "Nothing unusual this week.",
      evidence_metric_ids: cash ? [cash.id] : ["revenue_30d"],
      severity: "info",
    });
  }

  const actions: MoneyBrief["suggested_actions"] = anomalies.slice(0, 2).map((a) => ({ action: a.suggestedAction, reason: a.message, confidence: a.severity === "high" ? "high" : "medium" }));
  if (actions.length === 0) actions.push({ action: "Nothing to do this week.", reason: "No rule fired on this period's numbers.", confidence: "medium" });

  return {
    headline,
    warm_line: anomalies.some((a) => a.severity === "high") ? "One thing needs your attention this week; the rest can wait." : "Steady week. Here is what the numbers say.",
    findings,
    suggested_actions: actions,
    disclaimer: DISCLAIMER,
  };
}
