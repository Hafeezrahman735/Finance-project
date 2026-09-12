import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions } from "@headlessui/react";
import React, { useEffect, useMemo, useState } from "react";
import { toMinor } from "@ledgeriq/shared";
import { money } from "../../lib/format";
import Button from "../ui/Button";
import Sheet from "../ui/Sheet";

const TYPE_LABEL = { INCOME: "Money in", EXPENSE: "Money out", ASSET: "Assets", LIABILITY: "Liabilities", EQUITY: "Equity" };

/**
 * Category picker (plan: Design specification §2). Opens as a sheet (bottom
 * sheet on mobile, dialog on desktop): a searchable list of accounts grouped
 * by type, plus a Split mode where several categories sum to the amount.
 *
 * Props:
 *   accounts     [{ id, name, type, systemKey }]
 *   amountMinor  the transaction amount the lines must sum to
 *   direction    "in" | "out" (orders the groups: income first for money in)
 *   current      [{ accountId, amountMinor }] existing lines (for split defaults)
 *   onPick(lines) → lines = [{ accountId, amountMinor }]
 */
export default function CategoryPicker({ open, onClose, accounts, amountMinor, currency = "USD", direction, current = [], title = "Category", onPick }) {
  const [query, setQuery] = useState("");
  const [split, setSplit] = useState(current.length > 1);
  const [rows, setRows] = useState(() => splitRows(current, amountMinor));

  useEffect(() => {
    if (open) {
      setQuery("");
      setSplit(current.length > 1);
      setRows(splitRows(current, amountMinor));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const usable = useMemo(() => accounts.filter((a) => a.systemKey !== "cash" && !a.systemKey?.startsWith("bank:")), [accounts]);
  const ordered = useMemo(() => {
    const first = direction === "in" ? "INCOME" : "EXPENSE";
    const rank = (t) => (t === first ? 0 : t === "EXPENSE" || t === "INCOME" ? 1 : 2);
    return [...usable].sort((a, b) => rank(a.type) - rank(b.type) || a.name.localeCompare(b.name));
  }, [usable, direction]);
  const filtered = query.trim() ? ordered.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase())) : ordered;

  const rowsTotal = rows.reduce((s, r) => s + (r.amountMinor ?? 0), 0);
  const remaining = amountMinor - rowsTotal;
  const splitValid = rows.every((r) => r.accountId && r.amountMinor > 0) && remaining === 0;

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {!split ? (
        <Combobox
          value={null}
          onChange={(account) => {
            if (account) onPick([{ accountId: account.id, amountMinor }]);
          }}
        >
          <ComboboxInput
            autoFocus
            aria-label="Search categories"
            placeholder="Type to search"
            className="mb-2 min-h-11 w-full rounded-ui border border-line bg-surface px-3 text-base"
            onChange={(e) => setQuery(e.target.value)}
          />
          <ComboboxOptions static className="max-h-80 overflow-y-auto">
            {filtered.length === 0 && <p className="px-3 py-4 text-muted">No category matches “{query}”.</p>}
            {groupBy(filtered).map(([type, list]) => (
              <div key={type} className="mb-2">
                <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{TYPE_LABEL[type] ?? type}</p>
                {list.map((a) => (
                  <ComboboxOption key={a.id} value={a} className="flex min-h-11 cursor-pointer items-center justify-between rounded-ui px-3 text-base data-[focus]:bg-accent-soft data-[selected]:font-semibold">
                    <span>{a.name}</span>
                    {current.length === 1 && current[0].accountId === a.id && <span className="text-sm text-muted">current</span>}
                  </ComboboxOption>
                ))}
              </div>
            ))}
          </ComboboxOptions>
          <div className="mt-3 border-t border-line pt-3">
            <Button variant="ghost" onClick={() => setSplit(true)}>
              Split across categories
            </Button>
          </div>
        </Combobox>
      ) : (
        <div>
          <p className="mb-3 text-sm text-muted">
            Split {money(amountMinor, currency)} across categories. Remaining:{" "}
            <span className={`tnum font-semibold ${remaining === 0 ? "text-positive" : "text-negative"}`}>{money(remaining, currency)}</span>
          </p>
          <div className="flex flex-col gap-2">
            {rows.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_8rem_2.75rem] gap-2">
                <select
                  aria-label={`Category ${i + 1}`}
                  value={row.accountId ?? ""}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, accountId: e.target.value } : r)))}
                  className="min-h-11 rounded-ui border border-line bg-surface px-2 text-base"
                >
                  <option value="">Choose…</option>
                  {ordered.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={`Amount ${i + 1}`}
                  inputMode="decimal"
                  value={row.text ?? ""}
                  onChange={(e) => {
                    const text = e.target.value;
                    let amt = 0;
                    try {
                      amt = toMinor(text, currency) ?? 0;
                    } catch {
                      amt = 0;
                    }
                    setRows(rows.map((r, j) => (j === i ? { ...r, text, amountMinor: amt } : r)));
                  }}
                  className="tnum min-h-11 rounded-ui border border-line bg-surface px-2 text-right text-base"
                />
                <button type="button" aria-label={`Remove line ${i + 1}`} disabled={rows.length <= 2} onClick={() => setRows(rows.filter((_, j) => j !== i))} className="min-h-11 rounded-ui text-muted hover:bg-bg disabled:opacity-40">
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setRows([...rows, { accountId: "", amountMinor: 0, text: "" }])}>
              Add a line
            </Button>
            {remaining !== 0 && rows.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => {
                  const last = rows.length - 1;
                  const amt = rows[last].amountMinor + remaining;
                  setRows(rows.map((r, j) => (j === last ? { ...r, amountMinor: amt, text: (amt / 100).toFixed(2) } : r)));
                }}
              >
                Put the rest on the last line
              </Button>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2 border-t border-line pt-3">
            <Button onClick={() => setSplit(false)}>Back</Button>
            <Button variant="primary" disabled={!splitValid} onClick={() => onPick(rows.map((r) => ({ accountId: r.accountId, amountMinor: r.amountMinor })))}>
              Save split
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function groupBy(list) {
  const map = new Map();
  for (const a of list) {
    if (!map.has(a.type)) map.set(a.type, []);
    map.get(a.type).push(a);
  }
  return [...map.entries()];
}

function splitRows(current, amountMinor) {
  if (current.length > 1) return current.map((l) => ({ accountId: l.accountId, amountMinor: l.amountMinor, text: (l.amountMinor / 100).toFixed(2) }));
  const half = Math.floor(amountMinor / 2);
  return [
    { accountId: current[0]?.accountId ?? "", amountMinor: half, text: (half / 100).toFixed(2) },
    { accountId: "", amountMinor: amountMinor - half, text: ((amountMinor - half) / 100).toFixed(2) },
  ];
}
