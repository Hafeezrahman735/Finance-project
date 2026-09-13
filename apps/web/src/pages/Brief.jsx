import React, { useContext, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import EvidenceText from "../components/brief/EvidenceText";
import AppShell from "../components/layout/AppShell";
import Button from "../components/ui/Button";
import { UserContext } from "../context/userContext";
import { useUserAuth } from "../hooks/useUserAuth";
import { briefs as briefsApi, errorCode, errorMessage } from "../lib/api";
import { shortDate } from "../lib/format";

/**
 * The weekly Money Brief on its own page (plan: Design specification §4).
 * Week label, headline, one warm line, findings as paragraphs ordered by
 * severity (no badges), every number tappable to its metric, one suggested
 * next step, footer with disclaimer / model / date. Degraded briefs render
 * as "This week's numbers" with a note; the first open gets a reveal line.
 */
export default function Brief() {
  useUserAuth();
  const { organization } = useContext(UserContext);
  const [state, setState] = useState({ loading: true, enabled: true, brief: null, error: null });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await briefsApi.current();
      setState({ loading: false, enabled: data.enabled, brief: data.brief, error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: errorMessage(err, "Could not load this week's brief") }));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const regenerate = async () => {
    setBusy(true);
    try {
      const data = await briefsApi.regenerate();
      setState((s) => ({ ...s, brief: { ...data.brief, firstOpen: false } }));
      toast.success("Brief refreshed");
    } catch (err) {
      toast.error(errorCode(err) === "brief_regeneration_limit" ? "Refreshed enough for one week; it renews on Monday." : errorMessage(err, "Could not refresh"));
    } finally {
      setBusy(false);
    }
  };

  const { loading, enabled, brief, error } = state;
  const canManage = organization?.role === "OWNER" || organization?.role === "ADMIN";
  const recurringMemos = brief ? Object.fromEntries(Object.keys(brief.metrics).filter((id) => id.startsWith("recurring:") && id.endsWith(":amount")).map((id) => [id.split(":")[1], brief.metrics[id].label.replace(/ \((monthly|weekly)\)$/, "")])) : {};
  const degraded = brief?.status === "DEGRADED";

  return (
    <AppShell active="brief">
      {error && (
        <div role="alert" className="mb-4 flex items-center justify-between rounded-ui border border-negative/40 bg-surface px-3 py-2 text-negative">
          <span>{error}</span>
          <Button onClick={load}>Retry</Button>
        </div>
      )}

      {loading && !brief && (
        <div aria-busy="true" className="animate-pulse">
          <div className="h-5 w-40 rounded-ui bg-line" />
          <div className="mt-4 h-12 w-3/4 rounded-ui bg-line" />
          <p className="mt-6 text-muted">Preparing this week's brief…</p>
        </div>
      )}

      {!loading && !enabled && (
        <section>
          <h1 className="text-title">Money Brief</h1>
          <p className="mt-3 text-muted">The weekly brief is switched off for {organization?.name ?? "this organization"}.</p>
        </section>
      )}

      {brief && (
        <article aria-labelledby="brief-headline" className="max-w-3xl">
          <p className="tnum text-sm text-muted">
            Week of {shortDate(brief.periodStart, { year: true })} · numbers as of {shortDate(brief.asOf)}
            {brief.insufficientData && <> · based on {brief.dataDays} {brief.dataDays === 1 ? "day" : "days"} of data</>}
          </p>
          {brief.firstOpen && !degraded && <p className="mt-6 font-display text-2xl">Your first brief.</p>}
          <h1 id="brief-headline" className={`mt-3 text-headline-sm sm:text-headline ${degraded ? "text-muted" : ""}`}>
            {degraded && !brief.insufficientData ? "This week's numbers" : <EvidenceText text={brief.brief.headline} metrics={brief.metrics} recurringMemos={recurringMemos} />}
          </h1>
          {degraded && !brief.insufficientData && (
            <p className="mt-3 text-lg">
              <EvidenceText text={brief.brief.headline} metrics={brief.metrics} recurringMemos={recurringMemos} />
            </p>
          )}
          {!degraded && <p className="mt-3 text-lg text-muted">{brief.brief.warm_line}</p>}
          {degraded && (
            <p role="note" className="mt-3 text-sm text-muted">
              {brief.insufficientData ? "Not enough activity yet for a full brief; the numbers below fill in as you import." : "AI narration unavailable this week; these are the numbers as computed."}
            </p>
          )}

          <section aria-labelledby="findings" className="mt-10">
            <h2 id="findings" className="font-sans text-base font-semibold">
              {brief.firstOpen && !degraded ? "Here's what we noticed" : "What we noticed"}
            </h2>
            <div className="mt-2 divide-y divide-line border-y border-line">
              {brief.brief.findings.map((f, i) => (
                <p key={i} className={`py-3 text-base leading-relaxed ${f.severity === "high" ? "border-l-[3px] border-accent pl-3" : ""}`}>
                  <EvidenceText text={f.claim} metrics={brief.metrics} evidenceIds={f.evidence_metric_ids} recurringMemos={recurringMemos} />
                </p>
              ))}
            </div>
          </section>

          <section aria-labelledby="next-step" className="mt-10">
            <h2 id="next-step" className="font-sans text-base font-semibold">
              Suggested next step
            </h2>
            <ol className="mt-2 list-decimal space-y-3 pl-5">
              {brief.brief.suggested_actions.map((a, i) => (
                <li key={i}>
                  <span className="block">
                    <EvidenceText text={a.action} metrics={brief.metrics} recurringMemos={recurringMemos} />
                  </span>
                  <span className="block text-sm text-muted">
                    <EvidenceText text={a.reason} metrics={brief.metrics} recurringMemos={recurringMemos} /> · {a.confidence} confidence
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <footer className="mt-12 border-t border-line pt-4 text-sm text-muted">
            <p>{brief.brief.disclaimer}</p>
            <p className="tnum mt-2">
              {brief.model ? `Narrated by ${brief.model}` : "Deterministic summary"} · generated {shortDate(brief.createdAt.slice(0, 10), { year: true })}
              {" · "}
              <Link to="/overview">Numbers on the Overview</Link>
            </p>
            {canManage && (
              <div className="mt-4 flex flex-wrap gap-3">
                <Button onClick={regenerate} disabled={busy}>
                  {busy ? "Refreshing…" : "Refresh this week's brief"}
                </Button>
              </div>
            )}
          </footer>
        </article>
      )}
    </AppShell>
  );
}
