import React from "react";
import { money, shortDate } from "../../lib/format";

/**
 * The deterministic metrics (plan E1) as plain typographic rows: label,
 * value, and what it was over the previous 30 days. No cards. Every value
 * shown here is a metric id the weekly brief may cite, so the two never
 * disagree.
 */
const byId = (view, id) => view.metrics.find((m) => m.id === id);

function Delta({ metric }) {
  if (!metric?.prev || metric.prev.value === null || metric.value === null)
    return null;
  return (
    <span className="tnum text-sm text-muted">was {metric.prev.display}</span>
  );
}

function Row({ metric, note }) {
  if (!metric) return null;
  return (
    <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[14rem_1fr_auto]">
      <dt className="text-muted">{metric.label}</dt>
      <dd className="tnum text-right font-medium sm:text-left">
        {metric.display}
      </dd>
      <dd className="col-span-2 sm:col-span-1 sm:text-right">
        <Delta metric={metric} />
        {note && <span className="block text-sm text-muted">{note}</span>}
      </dd>
    </div>
  );
}

export default function Numbers({ view }) {
  if (!view) return null;
  const grossPct = byId(view, "gross_margin_pct_30d");
  const burn = byId(view, "net_burn_30d");
  const late = view.processors.filter(
    (p) =>
      p.balanceMinor > 0 &&
      p.daysSinceLastPayout !== null &&
      p.daysSinceLastPayout >= 7,
  );

  return (
    <section aria-labelledby="numbers" className="mt-10">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 id="numbers" className="font-sans text-base font-semibold">
          Numbers
        </h2>
        <p className="tnum text-sm text-muted">
          {shortDate(view.window.from)} – {shortDate(view.window.to)}
          {view.insufficientData && (
            <>
              {" "}
              · based on {view.dataDays} {view.dataDays === 1 ? "day" : "days"}{" "}
              of data
            </>
          )}
        </p>
      </div>

      <dl className="divide-y divide-line border-y border-line">
        <Row
          metric={byId(view, "gross_margin_30d")}
          note={
            grossPct?.value !== null
              ? `${grossPct.display} of revenue, after refunds, fees, and COGS`
              : null
          }
        />
        <Row
          metric={byId(view, "ad_spend_30d")}
          note={
            byId(view, "roas_30d")?.value !== null
              ? `blended ROAS ${byId(view, "roas_30d").display}`
              : null
          }
        />
        <Row
          metric={byId(view, "processor_fees_30d")}
          note={
            byId(view, "fee_rate_30d")?.value !== null
              ? `${byId(view, "fee_rate_30d").display} of revenue`
              : null
          }
        />
        <Row metric={burn} note={burn?.note} />
        <Row
          metric={byId(view, "recurring_monthly_total")}
          note={byId(view, "recurring_monthly_total")?.note}
        />
        <Row
          metric={byId(view, "clearing_balance")}
          note={
            late.length > 0
              ? `${late.map((p) => `${p.name}: ${p.daysSinceLastPayout} days since the last payout`).join(" · ")}`
              : view.processors.length > 0
                ? "Payouts are arriving on schedule."
                : null
          }
        />
      </dl>

      {view.channels.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <h3 className="mb-1 font-sans text-sm font-semibold">By channel</h3>
          <table className="w-full min-w-[36rem] text-left">
            <caption className="sr-only">
              Per-channel revenue, fees, COGS, ad spend, gross margin, and ROAS
              for the last 30 days
            </caption>
            <thead>
              <tr className="text-sm text-muted">
                <th scope="col" className="py-1.5 pr-3 font-normal">
                  Channel
                </th>
                {[
                  "Revenue",
                  "Fee rate",
                  "COGS",
                  "Ad spend",
                  "Margin",
                  "ROAS",
                ].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="py-1.5 pr-3 text-right font-normal"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tnum">
              {view.channels.map((c) => {
                const m = (k) => byId(view, `channel:${c.id}:${k}`);
                const margin = m("gross_margin");
                return (
                  <tr key={c.id} className="border-t border-line">
                    <th scope="row" className="py-2 pr-3 font-normal">
                      {c.name}
                    </th>
                    <td className="py-2 pr-3 text-right">
                      {m("revenue")?.display}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {m("fee_rate")?.display}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {m("cogs")?.display}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {m("ad_spend")?.display}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right ${margin?.value < 0 ? "text-negative" : ""}`}
                    >
                      {margin?.display}
                      {m("gross_margin_pct")?.value !== null && (
                        <span className="text-muted">
                          {" "}
                          · {m("gross_margin_pct")?.display}
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">{m("roas")?.display}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {view.recurring.length > 0 && (
        <>
          <h3 className="mb-1 mt-6 font-sans text-sm font-semibold">
            Recurring charges
          </h3>
          <ul className="divide-y divide-line border-y border-line">
            {view.recurring.map((r) => (
              <li
                key={r.slug}
                className="grid grid-cols-[1fr_auto] items-baseline gap-3 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate">{r.memo}</span>
                  <span className="tnum block text-sm text-muted">
                    {r.cadence} · {r.occurrences} charges
                    {r.deltaPct !== null && r.deltaPct !== 0 && (
                      <>
                        {" "}
                        ·{" "}
                        <span
                          className={
                            r.deltaPct > 0 ? "text-negative" : "text-positive"
                          }
                        >
                          {r.deltaPct > 0 ? "up" : "down"}{" "}
                          {Math.abs(r.deltaPct).toFixed(0)}%
                        </span>{" "}
                        from {money(r.prevAmountMinor, view.currency)}
                      </>
                    )}
                  </span>
                </span>
                <span className="tnum">
                  {money(r.amountMinor, view.currency)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
