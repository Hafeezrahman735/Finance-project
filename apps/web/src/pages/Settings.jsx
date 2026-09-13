import React, { useContext, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import AppShell from "../components/layout/AppShell";
import Button from "../components/ui/Button";
import { UserContext } from "../context/userContext";
import { useUserAuth } from "../hooks/useUserAuth";
import { bankAccounts as bankApi, errorMessage, features as featuresApi, imports as importsApi, rules as rulesApi } from "../lib/api";
import { shortDate } from "../lib/format";

/** Settings: organization, bank accounts, import history, categorization rules. */
export default function Settings() {
  useUserAuth();
  const { organization, user } = useContext(UserContext);
  const [banks, setBanks] = useState([]);
  const [rules, setRules] = useState([]);
  const [history, setHistory] = useState([]);
  const [features, setFeatures] = useState(null);
  const [error, setError] = useState(null);

  const load = () =>
    Promise.all([bankApi.list(), rulesApi.list(), importsApi.list(), featuresApi.get()])
      .then(([b, r, h, f]) => {
        setBanks(b);
        setRules(r);
        setHistory(h);
        setFeatures(f);
      })
      .catch((err) => setError(errorMessage(err)));

  useEffect(() => {
    load();
  }, []);

  const toggleBrief = async () => {
    try {
      setFeatures(await featuresApi.update({ moneyBrief: !features?.moneyBrief }));
      toast.success(features?.moneyBrief ? "Weekly brief switched off" : "Weekly brief switched on");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const removeRule = async (rule) => {
    try {
      await rulesApi.remove(rule.id);
      setRules(rules.filter((r) => r.id !== rule.id));
      toast.success("Rule removed");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <AppShell active="settings">
      <h1 className="text-headline-sm sm:text-headline">Settings</h1>
      {error && (
        <p role="alert" className="mt-4 text-negative">
          {error}
        </p>
      )}

      <section aria-labelledby="org" className="mt-8">
        <h2 id="org" className="font-sans text-base font-semibold">
          Organization
        </h2>
        <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1 text-base">
          <dt className="text-muted">Name</dt>
          <dd>{organization?.name}</dd>
          <dt className="text-muted">Currency</dt>
          <dd>{organization?.currency}</dd>
          <dt className="text-muted">Timezone</dt>
          <dd>{organization?.timezone}</dd>
          <dt className="text-muted">Your role</dt>
          <dd>{organization?.role?.toLowerCase()}</dd>
          <dt className="text-muted">Signed in as</dt>
          <dd>{user?.email}</dd>
        </dl>
      </section>

      <section aria-labelledby="brief-setting" className="mt-10">
        <h2 id="brief-setting" className="font-sans text-base font-semibold">
          Weekly brief
        </h2>
        <p className="mt-2 max-w-2xl text-muted">
          Off until an owner switches it on. When on, each week's numbers (metric names and values, channel names, and the merchant names of recurring charges; never
          transaction rows or customer details) are narrated by a Claude model when the server has an Anthropic key; without a key the brief is a plain summary computed
          here.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="text-base">{features === null ? "…" : features.moneyBrief ? "On" : "Off"}</span>
          {organization?.role === "OWNER" && features !== null && <Button onClick={toggleBrief}>{features.moneyBrief ? "Switch off" : "Switch on"}</Button>}
          {organization?.role !== "OWNER" && <span className="text-sm text-muted">Only the owner can change this.</span>}
        </div>
      </section>

      <section aria-labelledby="banks" className="mt-10">
        <div className="flex items-baseline justify-between">
          <h2 id="banks" className="font-sans text-base font-semibold">
            Bank accounts
          </h2>
          <Link to="/import" className="text-sm">
            Import a statement
          </Link>
        </div>
        {banks.length === 0 ? (
          <p className="mt-2 text-muted">None yet. You add one the first time you import a statement.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {banks.map((b) => (
              <li key={b.id} className="flex items-center justify-between py-3">
                <span>
                  {b.name}
                  {b.mask ? <span className="text-muted"> ···{b.mask}</span> : null}
                </span>
                <span className="text-sm text-muted">{b.kind.toLowerCase().replace("_", " ")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="rules" className="mt-10">
        <h2 id="rules" className="font-sans text-base font-semibold">
          Categorization rules
        </h2>
        <p className="mt-1 text-sm text-muted">Created from the category picker ("Always categorize … this way"). Applied to imports, first match wins.</p>
        {rules.length === 0 ? (
          <p className="mt-2 text-muted">No rules yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {rules.map((r) => (
              <li key={r.id} className="grid grid-cols-[1fr_auto] items-center gap-3 py-3 sm:grid-cols-[1fr_1fr_6rem_auto]">
                <span className="truncate">
                  <span className="text-muted">{r.match === "CONTAINS" ? "contains" : r.match === "EXACT" ? "is" : "matches"}</span> “{r.pattern}”
                </span>
                <span className="hidden truncate sm:block">→ {r.accountName}</span>
                <span className="tnum hidden text-sm text-muted sm:block">{r.hitCount} hit{r.hitCount === 1 ? "" : "s"}</span>
                <Button variant="ghost" onClick={() => removeRule(r)} aria-label={`Remove rule ${r.pattern}`}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="history" className="mt-10">
        <h2 id="history" className="font-sans text-base font-semibold">
          Import history
        </h2>
        {history.length === 0 ? (
          <p className="mt-2 text-muted">No imports yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {history.map((h) => (
              <li key={h.id} className="grid grid-cols-[1fr_auto] gap-3 py-3 text-base">
                <span className="min-w-0">
                  <span className="block truncate">{h.filename}</span>
                  <span className="tnum block text-sm text-muted">
                    {shortDate(h.createdAt.slice(0, 10), { year: true })} · {h.importedCount} imported
                    {h.duplicateCount ? `, ${h.duplicateCount} duplicates` : ""}
                    {h.invalidCount ? `, ${h.invalidCount} unreadable` : ""}
                  </span>
                </span>
                <span className={`text-sm ${h.status === "FAILED" ? "text-negative" : "text-muted"}`}>{h.status.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
