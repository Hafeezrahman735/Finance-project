import { addCalendarDays, bigintToMinor, calendarToDateColumn, dateColumnToCalendar, lastNDays, type CalendarDate, type Minor } from "@ledgeriq/shared";
import type { Db } from "../../db/prisma.js";
import { AccountType, EntryStatus } from "../../generated/prisma/enums.js";
import { transactionsService, type TransactionView } from "../transactions/transactions.js";

/**
 * Overview numbers straight from the ledger, windows computed as calendar
 * dates in the organization's timezone (ADR 0004). Shape matches what the
 * current Home page reads, with amounts in minor units.
 *
 *   totalIncome  = credits - debits on INCOME accounts (all time)
 *   totalExpense = debits - credits on EXPENSE accounts, excluding Uncategorized? No:
 *                  Uncategorized is an EXPENSE-typed holding account, so
 *                  uncategorized money out counts as expense until categorized
 *                  and the Overview says so via `uncategorizedCount`.
 */
/** Money in / money out through bank-side lines per calendar day (the Overview chart). */
export interface DailyFlow {
  date: CalendarDate;
  inMinor: Minor;
  outMinor: Minor;
}

export interface DashboardView {
  currency: string;
  timezone: string;
  today: CalendarDate;
  totalBalanceMinor: Minor;
  totalIncomeMinor: Minor;
  totalExpenseMinor: Minor;
  cashOnHandMinor: Minor;
  uncategorizedCount: number;
  last30Days: { from: CalendarDate; to: CalendarDate; incomeMinor: Minor; expenseMinor: Minor; transactions: TransactionView[]; daily: DailyFlow[] };
  last60DaysIncome: { from: CalendarDate; to: CalendarDate; totalMinor: Minor; transactions: TransactionView[] };
  recentTransactions: TransactionView[];
}

export function dashboardService(db: Db) {
  const txns = transactionsService(db);

  async function sumByType(organizationId: string, type: AccountType, from?: CalendarDate, to?: CalendarDate): Promise<Minor> {
    const agg = await db.journalLine.aggregate({
      where: {
        organizationId,
        account: { type },
        entry: {
          status: { in: [EntryStatus.POSTED, EntryStatus.REVERSED] },
          ...(from || to ? { date: { ...(from ? { gte: calendarToDateColumn(from) } : {}), ...(to ? { lte: calendarToDateColumn(to) } : {}) } } : {}),
        },
      },
      _sum: { debitMinor: true, creditMinor: true },
    });
    const debit = bigintToMinor(agg._sum.debitMinor ?? 0n);
    const credit = bigintToMinor(agg._sum.creditMinor ?? 0n);
    return type === AccountType.INCOME || type === AccountType.LIABILITY || type === AccountType.EQUITY ? credit - debit : debit - credit;
  }

  return {
    async get(organizationId: string, currency: string, timezone: string, now: Date = new Date()): Promise<DashboardView> {
      const d30 = lastNDays(30, timezone, now);
      const d60 = lastNDays(60, timezone, now);

      const cashAccounts = await db.account.findMany({ where: { organizationId, type: AccountType.ASSET, OR: [{ systemKey: "cash" }, { systemKey: { startsWith: "bank:" } }] }, select: { id: true } });
      const [totalIncome, totalExpense, income30, expense30, income60, cashAgg, uncategorizedCount, recent, in60, all30, bankLines30] = await Promise.all([
        sumByType(organizationId, AccountType.INCOME),
        sumByType(organizationId, AccountType.EXPENSE),
        sumByType(organizationId, AccountType.INCOME, d30.from, d30.to),
        sumByType(organizationId, AccountType.EXPENSE, d30.from, d30.to),
        sumByType(organizationId, AccountType.INCOME, d60.from, d60.to),
        db.journalLine.aggregate({ where: { organizationId, accountId: { in: cashAccounts.map((a) => a.id) }, entry: { status: { in: [EntryStatus.POSTED, EntryStatus.REVERSED] } } }, _sum: { debitMinor: true, creditMinor: true } }),
        db.journalEntry.count({ where: { organizationId, status: EntryStatus.POSTED, reversesEntryId: null, lines: { some: { isBankSide: false, account: { systemKey: "uncategorized" } } } } }),
        txns.list(organizationId, { limit: 5, status: "all", includeReversed: false }),
        txns.list(organizationId, { limit: 50, status: "all", includeReversed: false, direction: "in", from: d60.from, to: d60.to }),
        txns.list(organizationId, { limit: 50, status: "all", includeReversed: false, from: d30.from, to: d30.to }),
        db.journalLine.findMany({
          where: { organizationId, isBankSide: true, entry: { status: EntryStatus.POSTED, reversesEntryId: null, date: { gte: calendarToDateColumn(d30.from), lte: calendarToDateColumn(d30.to) } } },
          select: { debitMinor: true, creditMinor: true, entry: { select: { date: true } } },
        }),
      ]);

      const byDay = new Map<CalendarDate, DailyFlow>();
      for (let i = 0; i < 30; i++) {
        const date = addCalendarDays(d30.from, i);
        byDay.set(date, { date, inMinor: 0, outMinor: 0 });
      }
      for (const l of bankLines30) {
        const day = byDay.get(dateColumnToCalendar(l.entry.date));
        if (!day) continue;
        day.inMinor += bigintToMinor(l.debitMinor);
        day.outMinor += bigintToMinor(l.creditMinor);
      }

      return {
        currency,
        timezone,
        today: d30.to,
        totalBalanceMinor: totalIncome - totalExpense,
        totalIncomeMinor: totalIncome,
        totalExpenseMinor: totalExpense,
        cashOnHandMinor: bigintToMinor(cashAgg._sum.debitMinor ?? 0n) - bigintToMinor(cashAgg._sum.creditMinor ?? 0n),
        uncategorizedCount,
        last30Days: { from: d30.from, to: d30.to, incomeMinor: income30, expenseMinor: expense30, transactions: all30.data, daily: [...byDay.values()] },
        last60DaysIncome: { from: d60.from, to: d60.to, totalMinor: income60, transactions: in60.data },
        recentTransactions: recent.data,
      };
    },
  };
}
