import React, { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Link, useNavigate } from "react-router-dom";
import BankConnections from "../components/banking/BankConnections";
import AppShell from "../components/layout/AppShell";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import { useUserAuth } from "../hooks/useUserAuth";
import { bankAccounts as bankApi, errorMessage, imports as importsApi } from "../lib/api";
import { money, shortDate } from "../lib/format";

/**
 * Import a statement (design spec §3): three steps, four questions.
 *   1 choose   bank account + file (drop zone)
 *   2 map      date · description · amount (or debit + credit) · sign, each with the first three values as proof
 *   3 preview  "212 new, 3 duplicates skipped, 1 couldn't be read" → commit → done
 */
const STEPS = ["Choose a file", "Confirm columns", "Review and import"];

export default function Import() {
  useUserAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [accounts, setAccounts] = useState(null);
  const [bankAccountId, setBankAccountId] = useState("");
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountKind, setNewAccountKind] = useState("CHECKING");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [imp, setImp] = useState(null); // { import, guess, sample }
  const [mapping, setMapping] = useState(null);
  const [preview, setPreview] = useState(null);
  const [includeDuplicates, setIncludeDuplicates] = useState(() => new Set());
  const [result, setResult] = useState(null);
  const dropRef = useRef(null);

  useEffect(() => {
    bankApi
      .list()
      .then((list) => {
        setAccounts(list);
        if (list[0]) setBankAccountId(list[0].id);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const createAccount = async () => {
    if (!newAccountName.trim()) return;
    setBusy(true);
    try {
      const created = await bankApi.create({ name: newAccountName.trim(), kind: newAccountKind });
      setAccounts([...(accounts ?? []), created]);
      setBankAccountId(created.id);
      setNewAccountName("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    if (!file || !bankAccountId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await importsApi.upload(bankAccountId, file);
      setImp(res);
      setMapping({ dateFormat: "auto", signConvention: "negativeIsOut", ...res.guess.mapping });
      setStep(1);
    } catch (err) {
      setError(errorMessage(err, "Could not read the file"));
    } finally {
      setBusy(false);
    }
  };

  const confirmMapping = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { ...mapping };
      if (body.amountColumn) {
        delete body.debitColumn;
        delete body.creditColumn;
      }
      const res = await importsApi.setMapping(imp.import.id, body);
      setImp((prev) => ({ ...prev, import: res.import }));
      setPreview(res.preview);
      setIncludeDuplicates(new Set());
      setStep(2);
    } catch (err) {
      setError(errorMessage(err, "Could not apply that mapping"));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await importsApi.commit(imp.import.id, [...includeDuplicates]);
      setResult(res);
      toast.success(`Imported ${res.importedCount}`);
    } catch (err) {
      setError(errorMessage(err, "Import failed part-way; press Import again to resume"));
      try {
        setImp((prev) => ({ ...prev }));
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
    }
  };

  const columns = imp?.import.columns ?? [];
  const evidence = imp?.guess.evidence ?? {};
  const usePair = mapping && !mapping.amountColumn && (mapping.debitColumn || mapping.creditColumn);

  return (
    <AppShell active="import">
      <header className="mb-6">
        <h1 className="text-headline-sm sm:text-headline">Import a statement</h1>
        <ol className="mt-2 flex flex-wrap gap-x-4 text-sm text-muted" aria-label="Steps">
          {STEPS.map((label, i) => (
            <li key={label} aria-current={i === step ? "step" : undefined} className={i === step ? "font-semibold text-text" : i < step ? "text-accent-strong" : ""}>
              {i + 1}. {label}
            </li>
          ))}
        </ol>
      </header>

      {error && (
        <p role="alert" className="mb-4 rounded-ui border border-negative/40 bg-surface px-3 py-2 text-negative">
          {error}
        </p>
      )}

      {step === 0 && (
        <section className="mb-8 max-w-xl" aria-labelledby="feeds">
          <h2 id="feeds" className="font-sans text-base font-semibold">
            Or let the bank send transactions
          </h2>
          <div className="mt-2">
            <BankConnections compact onChange={() => bankApi.list().then(setAccounts).catch(() => {})} />
          </div>
        </section>
      )}

      {step === 0 && (
        <section className="flex max-w-xl flex-col gap-5">
          {accounts && accounts.length > 0 ? (
            <Field label="Which account is this statement from?">
              <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.mask ? ` ···${a.mask}` : ""}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            accounts && <p className="text-muted">Add the bank account this statement belongs to. You only do this once per account.</p>
          )}
          <details open={accounts && accounts.length === 0} className="rounded-ui border border-line bg-surface p-4">
            <summary className="cursor-pointer font-medium">{accounts && accounts.length === 0 ? "Add a bank account" : "Add another bank account"}</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_11rem_auto] sm:items-end">
              <Field label="Name">
                <input value={newAccountName} onChange={(e) => setNewAccountName(e.target.value)} placeholder="Business checking" />
              </Field>
              <Field label="Type">
                <select value={newAccountKind} onChange={(e) => setNewAccountKind(e.target.value)}>
                  <option value="CHECKING">Checking</option>
                  <option value="SAVINGS">Savings</option>
                  <option value="CREDIT_CARD">Credit card</option>
                  <option value="OTHER">Other</option>
                </select>
              </Field>
              <Button onClick={createAccount} disabled={busy || !newAccountName.trim()}>
                Add
              </Button>
            </div>
          </details>

          <div
            ref={dropRef}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) setFile(f);
            }}
            className="rounded-ui border-2 border-dashed border-line bg-surface p-6 text-center"
          >
            <p className="text-lg">{file ? file.name : "Drop a CSV here"}</p>
            <p className="mt-1 text-sm text-muted">Export it from your bank's website. Up to 10 MB, 50,000 rows.</p>
            <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center rounded-ui border border-line bg-surface px-4 hover:bg-bg">
              Choose a file
              <input type="file" accept=".csv,text/csv,.txt" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>

          <div className="flex gap-2">
            <Button variant="primary" disabled={busy || !file || !bankAccountId} onClick={upload}>
              {busy ? "Reading…" : "Continue"}
            </Button>
            <Button onClick={() => navigate("/transactions")}>Cancel</Button>
          </div>
        </section>
      )}

      {step === 1 && mapping && (
        <section className="flex max-w-2xl flex-col gap-5">
          <p className="text-muted">
            {imp.import.rowCount.toLocaleString()} rows, {columns.length} columns. We guessed the important ones; check the samples under each.
            {imp.guess.dateAmbiguous && <span className="text-warn"> The dates could be day-first or month-first, so please choose.</span>}
          </p>
          <ColumnQuestion label="Which column is the date?" value={mapping.dateColumn} columns={columns} evidence={evidence} onChange={(v) => setMapping({ ...mapping, dateColumn: v })} />
          <Field label="How are dates written?">
            <select value={mapping.dateFormat} onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value })}>
              <option value="auto">Work it out</option>
              <option value="MDY">Month / day / year (US)</option>
              <option value="DMY">Day / month / year</option>
              <option value="YMD">Year-month-day</option>
            </select>
          </Field>
          <ColumnQuestion label="Which column describes the transaction?" value={mapping.descriptionColumn} columns={columns} evidence={evidence} onChange={(v) => setMapping({ ...mapping, descriptionColumn: v })} />
          {!usePair ? (
            <>
              <ColumnQuestion label="Which column is the amount?" value={mapping.amountColumn} columns={columns} evidence={evidence} onChange={(v) => setMapping({ ...mapping, amountColumn: v })} />
              <Field label="How is money out written?">
                <select value={mapping.signConvention} onChange={(e) => setMapping({ ...mapping, signConvention: e.target.value })}>
                  <option value="negativeIsOut">As a negative number (most bank exports)</option>
                  <option value="positiveIsOut">As a positive number (most card statements)</option>
                </select>
              </Field>
              <Button variant="ghost" onClick={() => setMapping({ ...mapping, amountColumn: undefined, debitColumn: mapping.debitColumn ?? "", creditColumn: mapping.creditColumn ?? "" })}>
                My file has separate money in / money out columns
              </Button>
            </>
          ) : (
            <>
              <ColumnQuestion label="Which column is money out?" value={mapping.debitColumn} columns={columns} evidence={evidence} onChange={(v) => setMapping({ ...mapping, debitColumn: v })} />
              <ColumnQuestion label="Which column is money in?" value={mapping.creditColumn} columns={columns} evidence={evidence} onChange={(v) => setMapping({ ...mapping, creditColumn: v })} />
              <Button variant="ghost" onClick={() => setMapping({ ...mapping, debitColumn: undefined, creditColumn: undefined, amountColumn: columns[0] })}>
                My file has one amount column
              </Button>
            </>
          )}
          <div className="flex gap-2">
            <Button variant="primary" disabled={busy || !mapping.dateColumn || !mapping.descriptionColumn || (!mapping.amountColumn && !(mapping.debitColumn && mapping.creditColumn))} onClick={confirmMapping}>
              {busy ? "Checking rows…" : "Continue"}
            </Button>
            <Button onClick={() => setStep(0)}>Back</Button>
          </div>
        </section>
      )}

      {step === 2 && preview && !result && (
        <section className="flex max-w-3xl flex-col gap-5">
          <p className="text-lg">
            <span className="tnum font-semibold">{imp.import.newCount.toLocaleString()}</span> new
            {imp.import.duplicateCount > 0 && (
              <>
                , <span className="tnum font-semibold">{imp.import.duplicateCount}</span> already imported (skipped)
              </>
            )}
            {imp.import.invalidCount > 0 && (
              <>
                , <span className="tnum font-semibold">{imp.import.invalidCount}</span> couldn't be read
              </>
            )}
            .
          </p>

          <RowTable title="First rows" rows={preview.newRows} currency={accounts?.find((a) => a.id === bankAccountId)?.currency} />

          {preview.duplicateRows.length > 0 && (
            <details className="rounded-ui border border-line bg-surface p-4">
              <summary className="cursor-pointer">Skipped as duplicates ({preview.duplicateRows.length}). Tick any that are genuinely new.</summary>
              <ul className="mt-3 divide-y divide-line">
                {preview.duplicateRows.map((r) => (
                  <li key={r.index} className="flex items-center gap-3 py-2">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-accent"
                      aria-label={`Import row ${r.index + 1} anyway`}
                      checked={includeDuplicates.has(r.index)}
                      onChange={(e) =>
                        setIncludeDuplicates((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(r.index);
                          else n.delete(r.index);
                          return n;
                        })
                      }
                    />
                    <span className="tnum w-20 text-sm text-muted">{r.date && shortDate(r.date)}</span>
                    <span className="min-w-0 flex-1 truncate">{r.description}</span>
                    <span className="tnum">{money(r.amountMinor ?? 0)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {preview.invalidRows.length > 0 && (
            <details className="rounded-ui border border-warn/40 bg-warn-soft p-4">
              <summary className="cursor-pointer">Couldn't be read ({preview.invalidRows.length}). These are skipped; fix the file or the column choices.</summary>
              <ul className="mt-3 divide-y divide-line text-sm">
                {preview.invalidRows.slice(0, 50).map((r) => (
                  <li key={r.index} className="py-2">
                    <span className="text-muted">Row {r.index + 2}:</span> {r.problem}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="flex gap-2">
            <Button variant="primary" disabled={busy || imp.import.newCount + includeDuplicates.size === 0} onClick={commit}>
              {busy ? "Importing…" : `Import ${(imp.import.newCount + includeDuplicates.size).toLocaleString()}`}
            </Button>
            <Button onClick={() => setStep(1)} disabled={busy}>
              Back
            </Button>
          </div>
        </section>
      )}

      {result && (
        <section className="max-w-2xl">
          <p className="text-lg">
            Imported <span className="tnum font-semibold">{result.importedCount.toLocaleString()}</span> transactions into {accounts?.find((a) => a.id === bankAccountId)?.name}.
          </p>
          <p className="mt-2 text-muted">Rules you've saved were applied on the way in. The rest are waiting in the queue.</p>
          <div className="mt-5 flex gap-2">
            <Button variant="primary" onClick={() => navigate("/transactions")}>
              Categorize the rest
            </Button>
            <Link to="/overview" className="inline-flex min-h-11 items-center px-2">
              Back to Overview
            </Link>
          </div>
        </section>
      )}
    </AppShell>
  );
}

function ColumnQuestion({ label, value, columns, evidence, onChange }) {
  const proof = value ? evidence[value] ?? [] : [];
  return (
    <Field label={label} hint={proof.length ? `Looks like: ${proof.map((v) => `“${v}”`).join(", ")}` : undefined}>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {columns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </Field>
  );
}

function RowTable({ title, rows, currency = "USD" }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-ui border border-line bg-surface">
      <table className="w-full text-base">
        <caption className="px-3 py-2 text-left text-sm font-semibold">{title}</caption>
        <thead className="text-left text-sm text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Date</th>
            <th scope="col" className="px-3 py-2 font-medium">Description</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.index} className="border-t border-line">
              <td className="tnum px-3 py-2 text-muted">{r.date && shortDate(r.date)}</td>
              <td className="max-w-md truncate px-3 py-2">{r.description}</td>
              <td className={`tnum px-3 py-2 text-right ${r.amountMinor > 0 ? "text-positive" : ""}`}>{money(r.amountMinor ?? 0, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
