import React, { useState } from "react";
import { toMinor } from "@ledgeriq/shared";
import { todayCalendar } from "../../lib/format";
import Button from "../ui/Button";
import Field from "../ui/Field";
import Sheet from "../ui/Sheet";

/**
 * "Add a transaction" (keyboard: n). Money in / money out, amount, date,
 * description, category. Submits minor units; the API posts a Cash entry.
 */
export default function AddTransactionForm({ open, onClose, accounts, currency = "USD", onSubmit, busy }) {
  const [direction, setDirection] = useState("out");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayCalendar());
  const [memo, setMemo] = useState("");
  const [accountId, setAccountId] = useState("");
  const [errors, setErrors] = useState({});

  const categories = accounts.filter((a) => a.systemKey !== "cash" && !a.systemKey?.startsWith("bank:") && (direction === "in" ? a.type === "INCOME" || a.type === "EQUITY" || a.type === "LIABILITY" : a.type !== "INCOME"));

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    let amountMinor = null;
    try {
      amountMinor = toMinor(amount, currency);
    } catch {
      next.amount = "Enter an amount like 12.50";
    }
    if (amountMinor !== null && amountMinor !== undefined && amountMinor <= 0 && !next.amount) next.amount = "Amount must be more than zero";
    if (amountMinor === null && !next.amount) next.amount = "Amount is required";
    if (!date) next.date = "Date is required";
    setErrors(next);
    if (Object.keys(next).length) return;
    await onSubmit({ direction, amountMinor, date, memo: memo.trim(), ...(accountId ? { accountId } : {}) });
    setAmount("");
    setMemo("");
    setAccountId("");
  };

  return (
    <Sheet open={open} onClose={onClose} title="Add a transaction">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="Direction" className="grid grid-cols-2 gap-2">
          {[
            ["out", "Money out"],
            ["in", "Money in"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={direction === value}
              onClick={() => {
                setDirection(value);
                setAccountId("");
              }}
              className={`min-h-11 rounded-ui border text-base ${direction === value ? "border-accent bg-accent-soft font-medium text-accent-strong" : "border-line bg-surface"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <Field label="Amount" error={errors.amount}>
          <input inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="tnum" />
        </Field>
        <Field label="Date" error={errors.date}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Description" hint="What it was, in your words.">
          <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} />
        </Field>
        <Field label="Category" hint="Leave blank to categorize later.">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Uncategorized</option>
            {categories.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Saving…" : "Add"}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
