import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import AppShell from "../components/layout/AppShell";
import AddTransactionForm from "../components/transactions/AddTransactionForm";
import CategoryPicker from "../components/transactions/CategoryPicker";
import TransactionRow from "../components/transactions/TransactionRow";
import Button from "../components/ui/Button";
import { useNavigate } from "react-router-dom";
import { useUserAuth } from "../hooks/useUserAuth";
import { accounts as accountsApi, errorCode, errorMessage, rules as rulesApi, transactions as txApi } from "../lib/api";
import { money } from "../lib/format";

const FILTERS = [
  { key: "queue", label: "Needs a category" },
  { key: "all", label: "All" },
  { key: "in", label: "Money in" },
  { key: "out", label: "Money out" },
];

/**
 * Transactions (plan: Design specification §2).
 *   headline: uncategorized count · filter pills · list (uncategorized first,
 *   then newest) · category picker per row · bulk bar on selection · undo toast
 *   · load more · keyboard: n add, / filter, j/k move, c categorize, Esc close.
 */
export default function Transactions() {
  useUserAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("all");
  const [queue, setQueue] = useState([]); // uncategorized (always fetched; shown first)
  const [rows, setRows] = useState([]); // the filtered list (may overlap queue; de-duplicated on render)
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [currency, setCurrency] = useState("USD");
  const [selected, setSelected] = useState(() => new Set());
  const [picker, setPicker] = useState(null); // { ids: [...], t?: single transaction }
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [bulkResult, setBulkResult] = useState(null); // { done, failed: [ids] }
  const searchRef = useRef(null);
  const [search, setSearch] = useState("");

  const load = useCallback(
    async (opts = {}) => {
      setLoading(true);
      setError(null);
      try {
        const params = filter === "in" || filter === "out" ? { direction: filter, limit: 50 } : { limit: 50 };
        const [q, list, accts] = await Promise.all([
          filter === "queue" ? Promise.resolve(null) : txApi.list({ status: "uncategorized", limit: 200 }),
          filter === "queue" ? txApi.list({ status: "uncategorized", limit: 50, ...(opts.cursor ? { cursor: opts.cursor } : {}) }) : txApi.list({ ...params, ...(opts.cursor ? { cursor: opts.cursor } : {}) }),
          accounts.length ? Promise.resolve(accounts) : accountsApi.list(),
        ]);
        setAccounts(accts);
        if (list.data[0]) setCurrency(list.data[0].currency);
        if (q) setQueue(q.data);
        setRows(opts.cursor ? (prev) => [...prev, ...list.data] : list.data);
        setNextCursor(list.nextCursor);
      } catch (err) {
        setError(errorMessage(err, "Could not load transactions"));
      } finally {
        setLoading(false);
      }
    },
    [filter, accounts],
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Uncategorized first, then the rest newest-first; search narrows by description/category.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (t) => !q || (t.memo || "").toLowerCase().includes(q) || (t.categoryName || "").toLowerCase().includes(q);
    if (filter === "queue") return rows.filter(match);
    const queueIds = new Set(queue.map((t) => t.id));
    const head = queue.filter((t) => (filter === "all" ? true : t.direction === filter)).filter(match);
    const tail = rows.filter((t) => !queueIds.has(t.id)).filter(match);
    return [...head, ...tail];
  }, [queue, rows, filter, search]);

  const uncategorizedCount = filter === "queue" ? rows.length : queue.length;

  // --- mutations -----------------------------------------------------------

  const applyLocal = (updated) => {
    setRows((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setQueue((prev) => (updated.uncategorized ? prev.map((t) => (t.id === updated.id ? updated : t)) : prev.filter((t) => t.id !== updated.id)));
  };

  const categorize = async (t, lines, { silent = false } = {}) => {
    const previous = t.lines.map((l) => ({ accountId: l.accountId, amountMinor: l.amountMinor, channelId: l.channelId }));
    const updated = await txApi.recategorize(t.id, t.version, lines);
    applyLocal(updated);
    if (!silent) {
      toast(
        (tt) => (
          <span className="flex items-center gap-3">
            <span>
              {updated.categoryName === "Split" ? "Split saved" : `Categorized as ${updated.categoryName}`}
            </span>
            <button
              type="button"
              className="font-semibold text-accent"
              onClick={async () => {
                toast.dismiss(tt.id);
                try {
                  const reverted = await txApi.recategorize(updated.id, updated.version, previous);
                  applyLocal(reverted);
                  if (reverted.uncategorized) setQueue((prev) => (prev.some((x) => x.id === reverted.id) ? prev : [reverted, ...prev]));
                } catch (err) {
                  toast.error(errorMessage(err, "Could not undo"));
                }
              }}
            >
              Undo
            </button>
          </span>
        ),
        { duration: 8000 },
      );
    }
    return updated;
  };

  const onPick = async (lines, rule) => {
    const target = picker;
    setPicker(null);
    if (!target) return;
    if (target.t) {
      try {
        await categorize(target.t, lines);
        if (rule && lines.length === 1) {
          const created = await rulesApi.create({ pattern: rule.pattern, accountId: lines[0].accountId, applyToExisting: true });
          if (created.applied > 0) {
            toast.success(`Rule saved; ${created.applied} more categorized`);
            load();
          } else {
            toast.success("Rule saved for future imports");
          }
        }
      } catch (err) {
        toast.error(errorCode(err) === "stale_version" ? "This row changed elsewhere; reloading." : errorMessage(err));
        if (errorCode(err) === "stale_version") load();
      }
      return;
    }
    // Bulk: one category applied to every selected row (splits are per-row only).
    const ids = target.ids;
    const failed = [];
    setBusy(true);
    for (const id of ids) {
      const t = visible.find((x) => x.id === id) ?? rows.find((x) => x.id === id) ?? queue.find((x) => x.id === id);
      if (!t) continue;
      try {
        await categorize(t, [{ accountId: lines[0].accountId, amountMinor: t.amountMinor }], { silent: true });
      } catch {
        failed.push(id);
      }
    }
    setBusy(false);
    setSelected(new Set(failed));
    setBulkResult({ done: ids.length - failed.length, total: ids.length, failed });
    if (failed.length === 0) toast.success(`${ids.length} categorized`);
  };

  const onAdd = async (body) => {
    setBusy(true);
    try {
      const created = await txApi.create(body);
      setAdding(false);
      toast.success(`Added ${money(created.amountMinor, created.currency)}`);
      load();
    } catch (err) {
      toast.error(errorMessage(err, "Could not add"));
    } finally {
      setBusy(false);
    }
  };

  // --- keyboard ------------------------------------------------------------

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable;
      if (e.key === "Escape") {
        setPicker(null);
        setAdding(false);
        setSelected(new Set());
        return;
      }
      if (typing || picker || adding) return;
      if (e.key === "n") {
        e.preventDefault();
        setAdding(true);
      } else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        setFocusIndex((i) => Math.max(0, Math.min(visible.length - 1, i + (e.key === "j" ? 1 : -1))));
      } else if (e.key === "c" && focusIndex >= 0 && visible[focusIndex]) {
        e.preventDefault();
        setPicker({ t: visible[focusIndex] });
      } else if (e.key === "x" && focusIndex >= 0 && visible[focusIndex]) {
        e.preventDefault();
        const id = visible[focusIndex].id;
        setSelected((s) => {
          const n = new Set(s);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, focusIndex, picker, adding]);

  useEffect(() => {
    if (focusIndex >= 0) document.querySelector(`li[data-id="${visible[focusIndex]?.id}"]`)?.focus();
  }, [focusIndex, visible]);

  const pickerTarget = picker?.t;

  return (
    <AppShell active="transactions">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-headline-sm sm:text-headline">
            {uncategorizedCount > 0 ? `${uncategorizedCount} need${uncategorizedCount === 1 ? "s" : ""} a category` : "Everything is categorized"}
          </h1>
          <p className="mt-1 hidden text-muted sm:block">Press <kbd className="rounded-ui border border-line px-1">n</kbd> to add, <kbd className="rounded-ui border border-line px-1">?</kbd> for shortcuts.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => navigate("/import")}>Import</Button>
          <Button onClick={() => txApi.exportXlsx(filter === "in" || filter === "out" ? filter : undefined).catch((err) => toast.error(errorMessage(err, "Export failed")))}>
            Export
          </Button>
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add transaction
          </Button>
        </div>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Filter" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => {
                setFilter(f.key);
                setSelected(new Set());
                setFocusIndex(-1);
              }}
              className={`min-h-11 rounded-full px-4 text-base ${filter === f.key ? "bg-text text-surface" : "bg-surface text-text border border-line hover:bg-bg"}`}
            >
              {f.label}
              {f.key === "queue" && queue.length > 0 && filter !== "queue" && <span className="tnum ml-2 text-sm opacity-80">{queue.length}</span>}
            </button>
          ))}
        </div>
        <input
          ref={searchRef}
          type="search"
          aria-label="Search transactions"
          placeholder="Search  /"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto min-h-11 w-full rounded-ui border border-line bg-surface px-3 sm:w-64"
        />
      </div>

      {error && (
        <div role="alert" className="mb-3 flex items-center justify-between rounded-ui border border-negative/40 bg-surface px-3 py-2 text-negative">
          <span>{error}</span>
          <Button onClick={() => load()}>Retry</Button>
        </div>
      )}

      {bulkResult && bulkResult.failed.length > 0 && (
        <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-ui border border-warn/40 bg-warn-soft px-3 py-2">
          <span>
            {bulkResult.done} of {bulkResult.total} updated. {bulkResult.failed.length} failed.
          </span>
          <span className="flex gap-2">
            <Button onClick={() => setPicker({ ids: bulkResult.failed })}>Retry {bulkResult.failed.length}</Button>
            <Button variant="ghost" onClick={() => setBulkResult(null)}>Dismiss</Button>
          </span>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <ul aria-busy="true" className="animate-pulse">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="h-14 border-b border-line" />
          ))}
        </ul>
      ) : visible.length === 0 ? (
        <EmptyState filter={filter} search={search} onAdd={() => setAdding(true)} />
      ) : (
        <ul aria-label="Transactions" className="rounded-ui border border-line bg-surface">
          {visible.map((t, i) => (
            <TransactionRow
              key={t.id}
              t={t}
              focused={i === focusIndex}
              selectable={selected.size > 0}
              selected={selected.has(t.id)}
              onSelect={(id, on) =>
                setSelected((s) => {
                  const n = new Set(s);
                  if (on) n.add(id);
                  else n.delete(id);
                  return n;
                })
              }
              onCategory={(row) => setPicker({ t: row })}
            />
          ))}
        </ul>
      )}

      {nextCursor && !loading && (
        <div className="mt-3 flex justify-center">
          <Button onClick={() => load({ cursor: nextCursor })}>Load more</Button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
            <span className="tnum">{selected.size} selected</span>
            <span className="flex gap-2">
              <Button onClick={() => setSelected(new Set())}>Clear</Button>
              <Button variant="primary" disabled={busy} onClick={() => setPicker({ ids: [...selected] })}>
                Categorize {selected.size}
              </Button>
            </span>
          </div>
        </div>
      )}

      <CategoryPicker
        open={!!picker}
        onClose={() => setPicker(null)}
        accounts={accounts}
        currency={currency}
        amountMinor={pickerTarget?.amountMinor ?? 0}
        direction={pickerTarget?.direction ?? "out"}
        current={pickerTarget ? pickerTarget.lines.map((l) => ({ accountId: l.accountId, amountMinor: l.amountMinor })) : []}
        title={pickerTarget ? `Category for ${money(pickerTarget.amountMinor, currency)}` : `Category for ${picker?.ids?.length ?? 0} transactions`}
        memo={pickerTarget?.memo ?? ""}
        onPick={onPick}
      />
      <AddTransactionForm open={adding} onClose={() => setAdding(false)} accounts={accounts} currency={currency} onSubmit={onAdd} busy={busy} />
    </AppShell>
  );
}

function EmptyState({ filter, search, onAdd }) {
  if (search) return <p className="rounded-ui border border-line bg-surface p-6 text-muted">Nothing matches “{search}”.</p>;
  if (filter === "queue")
    return (
      <div className="rounded-ui border border-line bg-surface p-6">
        <p className="text-lg">Nothing needs a category.</p>
        <p className="mt-1 text-muted">New imports and manual entries without a category land here.</p>
      </div>
    );
  return (
    <div className="rounded-ui border border-line bg-surface p-6">
      <p className="text-lg">No transactions yet.</p>
      <p className="mt-1 text-muted">Add one now; CSV import and bank connections are next.</p>
      <Button variant="primary" className="mt-4" onClick={onAdd}>
        Add a transaction
      </Button>
    </div>
  );
}
