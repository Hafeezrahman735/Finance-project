import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppShell from "../components/layout/AppShell";
import InOutChart from "../components/overview/InOutChart";
import Button from "../components/ui/Button";
import { useUserAuth } from "../hooks/useUserAuth";
import { dashboard as dashboardApi, errorMessage } from "../lib/api";
import { headlineCopy, money, shortDate } from "../lib/format";

/**
 * Overview (plan: Design specification §1). First the headline sentence,
 * second cash on hand, third one primary action. Chart and recent activity
 * below the fold. The headline is present in every state, including empty.
 */
export default function Overview() {
  useUserAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await dashboardApi.get());
    } catch (err) {
      setError(errorMessage(err, "Could not load the overview"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const hasAnyData = !!data && (data.totalIncomeMinor !== 0 || data.totalExpenseMinor !== 0 || data.recentTransactions.length > 0);
  const headline = data
    ? headlineCopy({ incomeMinor: data.last30Days.incomeMinor, expenseMinor: data.last30Days.expenseMinor, uncategorizedCount: data.uncategorizedCount, hasAnyData, currency: data.currency })
    : null;

  const primary = !data
    ? null
    : !hasAnyData
      ? { label: "Add a transaction", to: "/transactions", hint: "CSV import and bank connections are next." }
      : data.uncategorizedCount > 0
        ? { label: `Categorize ${data.uncategorizedCount}`, to: "/transactions", hint: "Your numbers firm up as the queue empties." }
        : { label: "Review transactions", to: "/transactions", hint: null };

  return (
    <AppShell active="overview">
      {error && (
        <div role="alert" className="mb-4 flex items-center justify-between rounded-ui border border-negative/40 bg-surface px-3 py-2 text-negative">
          <span>{error}</span>
          <Button onClick={load}>Retry</Button>
        </div>
      )}

      <section aria-labelledby="headline">
        {loading && !data ? (
          <div aria-busy="true" className="animate-pulse">
            <div className="h-12 w-3/4 rounded-ui bg-line" />
            <div className="mt-3 h-6 w-1/3 rounded-ui bg-line" />
          </div>
        ) : (
          data && (
            <>
              <h1 id="headline" aria-live="polite" className={`headline-tween max-w-3xl text-headline-sm sm:text-headline ${headline.muted ? "text-muted" : "text-text"}`}>
                {headline.text}
              </h1>
              <p className="tnum mt-3 text-lg text-muted">
                Cash on hand <span className="font-medium text-text">{money(data.cashOnHandMinor, data.currency)}</span>
                {data.uncategorizedCount > 0 && (
                  <>
                    {" "}
                    · <span className="text-text">{data.uncategorizedCount}</span> need{data.uncategorizedCount === 1 ? "s" : ""} a category
                  </>
                )}
              </p>
              {primary && (
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <Button variant="primary" onClick={() => navigate(primary.to)}>
                    {primary.label}
                  </Button>
                  {primary.hint && <span className="text-muted">{primary.hint}</span>}
                </div>
              )}
            </>
          )
        )}
      </section>

      {data && hasAnyData && (
        <>
          <section aria-labelledby="last30" className="mt-12">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 id="last30" className="font-sans text-base font-semibold">
                Last 30 days
              </h2>
              <p className="tnum text-sm text-muted">
                {shortDate(data.last30Days.from)} – {shortDate(data.last30Days.to)} · in <span className="text-positive">{money(data.last30Days.incomeMinor, data.currency)}</span> · out {money(data.last30Days.expenseMinor, data.currency)}
              </p>
            </div>
            <InOutChart daily={data.last30Days.daily} currency={data.currency} />
          </section>

          <section aria-labelledby="recent" className="mt-10">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 id="recent" className="font-sans text-base font-semibold">
                Recent
              </h2>
              <Link to="/transactions" className="text-sm">
                All transactions
              </Link>
            </div>
            <ul className="divide-y divide-line border-y border-line">
              {data.recentTransactions.map((t) => (
                <li key={t.id} className="grid grid-cols-[1fr_auto] items-center gap-3 py-3">
                  <span className="min-w-0">
                    <span className="block truncate">{t.memo || t.categoryName}</span>
                    <span className="tnum block text-sm text-muted">
                      {shortDate(t.date)} · {t.uncategorized ? <span className="text-accent">needs a category</span> : t.categoryName}
                    </span>
                  </span>
                  <span className={`tnum ${t.direction === "in" ? "text-positive" : ""}`}>
                    {t.direction === "in" ? "+" : "−"}
                    {money(t.amountMinor, t.currency, { signDisplay: "never" })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </AppShell>
  );
}
