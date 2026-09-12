import { formatMoney as sharedFormatMoney } from "@ledgeriq/shared";

/** The only money formatter in the web app (ADR 0002). */
export function money(minor, currency = "USD", opts = {}) {
  return sharedFormatMoney(minor, currency, undefined, opts);
}

/** "12 Sep" / "12 Sep 2025" from a YYYY-MM-DD calendar date, without timezone drift. */
export function shortDate(calendarDate, { year = false } = {}) {
  const [y, m, d] = calendarDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(date);
}

export function todayCalendar() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Overview headline (plan: Design specification §1; tone T3 terse CFO).
 * One sentence, ≤ 2 lines, about the last 30 days.
 */
export function headlineCopy({ incomeMinor, expenseMinor, uncategorizedCount, hasAnyData, currency = "USD" }) {
  if (!hasAnyData) {
    return { text: "Nothing recorded yet. Add a transaction and this line will tell you what happened.", muted: true };
  }
  const net = incomeMinor - expenseMinor;
  const abs = money(Math.abs(net), currency);
  if (uncategorizedCount > 0 && incomeMinor === 0 && expenseMinor > 0) {
    return { text: `About ${money(expenseMinor, currency)} went out in the last 30 days. Categorize to see where.`, muted: true };
  }
  if (net > 0) return { text: `You brought in ${abs} more than you spent in the last 30 days.`, muted: false };
  if (net < 0) return { text: `You spent ${abs} more than you brought in over the last 30 days.`, muted: false };
  return { text: "Money in and money out were equal over the last 30 days.", muted: false };
}
