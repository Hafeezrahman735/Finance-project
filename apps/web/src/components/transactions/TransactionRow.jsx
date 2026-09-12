import React from "react";
import { money, shortDate } from "../../lib/format";

/**
 * One transaction. Desktop: a table row. Under 640px: a two-line card with
 * the category as a tappable line beneath (plan: Pass 6). Uncategorized rows
 * carry a 3px left accent and nothing else. The category cell is a button
 * that opens the picker; the whole row is keyboard-focusable for j/k.
 */
export default function TransactionRow({ t, selected, selectable, onSelect, onCategory, focused, rowRef }) {
  const amount = money(t.amountMinor, t.currency, { signDisplay: "never" });
  const sign = t.direction === "in" ? "+" : "−";
  return (
    <li
      ref={rowRef}
      tabIndex={0}
      data-id={t.id}
      aria-current={focused ? "true" : undefined}
      className={`group grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-line px-3 py-3 focus:outline-none focus-visible:bg-accent-soft sm:grid-cols-[auto_7rem_1fr_14rem_8rem] sm:gap-4 ${t.uncategorized ? "border-l-[3px] border-l-accent" : "border-l-[3px] border-l-transparent"} ${focused ? "bg-accent-soft/60" : ""}`}
    >
      <span className={`${selectable ? "" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"} flex items-center`}>
        <input
          type="checkbox"
          aria-label={`Select ${t.memo || t.categoryName}`}
          checked={selected}
          onChange={(e) => onSelect(t.id, e.target.checked)}
          className="h-5 w-5 accent-accent"
        />
      </span>

      <span className="tnum hidden text-sm text-muted sm:block">{shortDate(t.date)}</span>

      <span className="min-w-0">
        <span className="block truncate text-base">{t.memo || t.categoryName || "(no description)"}</span>
        <span className="tnum block text-sm text-muted sm:hidden">{shortDate(t.date)}</span>
        <button
          type="button"
          onClick={() => onCategory(t)}
          className={`mt-1 inline-flex min-h-11 items-center rounded-ui px-2 text-base sm:hidden ${t.uncategorized ? "text-accent font-medium" : "text-muted"}`}
        >
          {t.uncategorized ? "Choose a category" : t.categoryName}
        </button>
      </span>

      <span className="hidden sm:block">
        <button
          type="button"
          onClick={() => onCategory(t)}
          className={`inline-flex min-h-11 w-full items-center justify-between rounded-ui border px-3 text-left text-base ${
            t.uncategorized ? "border-accent text-accent font-medium hover:bg-accent-soft" : "border-transparent text-text hover:border-line hover:bg-bg"
          }`}
        >
          <span className="truncate">{t.uncategorized ? "Choose a category" : t.categoryName}</span>
          <span aria-hidden="true" className="ml-2 text-muted">
            ▾
          </span>
        </button>
      </span>

      <span className={`tnum text-right text-base font-medium ${t.direction === "in" ? "text-positive" : "text-text"}`}>
        {sign}
        {amount}
      </span>
    </li>
  );
}
