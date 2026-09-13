import type { Metric, MetricsView } from "../metrics/metrics.js";
import type { Anomaly } from "./schema.js";

/**
 * Anomaly rules (plan Phase 4, no LLM). Each rule reads the metrics view and
 * emits a sentence built only from metric display strings, so the fallback
 * brief and the model's evidence are the same numbers. Thresholds are the
 * plan's defaults; tune per org later.
 */
export const THRESHOLDS = {
  recurringJumpPct: 20,
  feeRateDriftPoints: 1,
  payoutMissingDays: 10, // weekly cadence + 3 business days
  roasDropRatio: 0.8,
  lowRunwayDays: 60,
  tightRunwayDays: 120,
  uncategorizedBacklog: 10,
  burnUpRatio: 1.5,
};

export function detectAnomalies(view: MetricsView): Anomaly[] {
  const byId = new Map(view.metrics.map((m) => [m.id, m]));
  const get = (id: string): Metric | undefined => byId.get(id);
  const out: Anomaly[] = [];

  // Recurring charge jumped
  for (const r of view.recurring) {
    if (r.deltaPct !== null && r.deltaPct >= THRESHOLDS.recurringJumpPct) {
      const amount = get(`recurring:${r.slug}:amount`)!;
      out.push({
        id: `recurring_jump:${r.slug}`,
        kind: "recurring_jump",
        severity: r.deltaPct >= 100 ? "high" : "warning",
        message: `${r.memo} charged ${amount.display}, up ${get(`recurring:${r.slug}:delta_pct`)!.display} from ${amount.prev!.display}.`,
        metricIds: [amount.id, `recurring:${r.slug}:delta_pct`],
        suggestedAction: `Check the ${r.memo} plan: confirm the new price is intended or downgrade.`,
      });
    }
  }

  // Processor fee rate drift per channel
  for (const c of view.channels) {
    const fee = get(`channel:${c.id}:fee_rate`);
    if (fee && fee.value !== null && fee.prev?.value != null && fee.value - fee.prev.value >= THRESHOLDS.feeRateDriftPoints) {
      out.push({
        id: `fee_rate_drift:${c.id}`,
        kind: "fee_rate_drift",
        severity: "warning",
        message: `${c.name} fees rose to ${fee.display} of revenue from ${fee.prev.display}.`,
        metricIds: [fee.id, `channel:${c.id}:fees`, `channel:${c.id}:revenue`],
        suggestedAction: `Check ${c.name}'s fee schedule or payout statements for the new rate.`,
        channelId: c.id,
      });
    }
  }

  // Payout missing
  for (const p of view.processors) {
    if (p.balanceMinor > 0 && p.daysSinceLastPayout !== null && p.daysSinceLastPayout >= THRESHOLDS.payoutMissingDays) {
      const bal = get(`clearing:${p.key}:balance`)!;
      const days = get(`clearing:${p.key}:days_since_payout`)!;
      out.push({
        id: `payout_missing:${p.key}`,
        kind: "payout_missing",
        severity: "high",
        message: `${bal.display} earned through ${p.name} has not been deposited; the last payout was ${days.display} ago.`,
        metricIds: [bal.id, days.id],
        suggestedAction: `Open the ${p.name} dashboard and confirm the payout schedule and bank account on file.`,
      });
    }
  }

  // ROAS drop per channel
  for (const c of view.channels) {
    const roas = get(`channel:${c.id}:roas`);
    if (roas && roas.value !== null && roas.prev?.value != null && roas.prev.value > 0 && roas.value < roas.prev.value * THRESHOLDS.roasDropRatio) {
      out.push({
        id: `roas_drop:${c.id}`,
        kind: "roas_drop",
        severity: roas.value < 1 ? "high" : "warning",
        message: `${c.name} ROAS fell to ${roas.display} from ${roas.prev.display}.`,
        metricIds: [roas.id, `channel:${c.id}:ad_spend`, `channel:${c.id}:revenue`],
        suggestedAction: `Review the ${c.name} ad sets that ran this month before adding budget.`,
        channelId: c.id,
      });
    }
  }

  // Gross margin negative per channel
  for (const c of view.channels) {
    const gm = get(`channel:${c.id}:gross_margin`);
    const rev = get(`channel:${c.id}:revenue`);
    if (gm && gm.value !== null && gm.value < 0 && rev && rev.value !== null && rev.value > 0) {
      out.push({
        id: `margin_negative:${c.id}`,
        kind: "margin_negative",
        severity: "high",
        message: `${c.name} lost money after fees and COGS: gross margin ${gm.display} on ${rev.display} in sales.`,
        metricIds: [gm.id, rev.id, `channel:${c.id}:cogs`, `channel:${c.id}:fees`],
        suggestedAction: `Reprice or pause the ${c.name} products with the thinnest margin.`,
        channelId: c.id,
      });
    }
  }

  // Runway
  const runway = get("runway_days");
  const cash = get("cash_on_hand");
  if (runway && runway.value !== null && cash) {
    if (runway.value < THRESHOLDS.lowRunwayDays) {
      out.push({
        id: "low_runway",
        kind: "low_runway",
        severity: "high",
        message: `At the current net cash burn, ${cash.display} on hand lasts about ${runway.display}.`,
        metricIds: [runway.id, cash.id, "net_burn_30d"],
        suggestedAction: "Decide this week what to cut or collect before the buffer is gone.",
      });
    } else if (runway.value < THRESHOLDS.tightRunwayDays) {
      out.push({
        id: "tight_runway",
        kind: "low_runway",
        severity: "warning",
        message: `Cash on hand ${cash.display} covers about ${runway.display} at the current net cash burn.`,
        metricIds: [runway.id, cash.id, "net_burn_30d"],
        suggestedAction: "Keep an eye on the burn; nothing urgent yet.",
      });
    }
  }

  // Burn accelerated
  const burn = get("net_burn_30d");
  if (burn && burn.value !== null && burn.prev?.value != null && burn.prev.value > 0 && burn.value > burn.prev.value * THRESHOLDS.burnUpRatio) {
    out.push({
      id: "burn_up",
      kind: "burn_up",
      severity: "warning",
      message: `Net cash burn was ${burn.display}, up from ${burn.prev.display} the month before.`,
      metricIds: [burn.id, "money_out_30d", "money_in_30d"],
      suggestedAction: "Look at what left the bank this month that did not the month before.",
    });
  }

  // Uncategorized backlog
  const unc = get("uncategorized_count");
  if (unc && unc.value !== null && unc.value >= THRESHOLDS.uncategorizedBacklog) {
    out.push({
      id: "uncategorized_backlog",
      kind: "uncategorized_backlog",
      severity: "info",
      message: `${unc.display} transactions still need a category, so margin and expense numbers are provisional.`,
      metricIds: [unc.id, "uncategorized_30d"],
      suggestedAction: `Categorize the ${unc.display} waiting transactions; rules will handle repeats.`,
    });
  }

  const rank = { high: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
