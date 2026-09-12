import { addCalendarDays, bigintToMinor, calendarToDateColumn, dateColumnToCalendar, daysBetween, formatMoney, lastNDays, type CalendarDate, type Minor } from "@ledgeriq/shared";
import type { Db } from "../../db/prisma.js";
import { AccountType, EntryStatus } from "../../generated/prisma/enums.js";
import type { Prisma } from "../../generated/prisma/client.js";

/**
 * Deterministic metrics layer (plan E1 / Phase 4 substrate).
 *
 *   ledger ──▶ compute(org, today) ──▶ MetricsView { metrics[], recurring[], processors[] }
 *                    │                        │
 *                    │                        └─ every number the brief may say, with an id and a
 *                    │                           pre-formatted display string (grounding contract)
 *                    └─ cached per (org, day) in metrics_snapshots; recomputed when the ledger
 *                       fingerprint (entry count + latest update) changes (CEO finding 7.1)
 *
 * The model narrates these; it never computes. Windows are calendar dates in
 * the organization's timezone (ADR 0004). Product-brand metrics (margin, ROAS,
 * fee rate, clearing lag) are per channel and blended.
 */

export type MetricUnit = "minor" | "percent" | "ratio" | "days" | "count";

export interface MetricWindow {
  from: CalendarDate;
  to: CalendarDate;
}

export interface Metric {
  /** Stable id: "cash_on_hand", "channel:<channelId>:roas", "recurring:<slug>:amount". */
  id: string;
  label: string;
  /** null = not computable from this data (e.g. runway when not burning cash). */
  value: number | null;
  unit: MetricUnit;
  /** Pre-formatted for humans and for the brief validator ("$8,713.29", "43.1%", "3.2x", "34 days"). */
  display: string;
  window: MetricWindow | null;
  channelId?: string;
  /** Same metric over the previous window, when it has one. */
  prev?: { value: number | null; display: string };
  note?: string;
}

export interface RecurringCharge {
  slug: string;
  memo: string;
  cadence: "monthly" | "weekly";
  amountMinor: Minor;
  prevAmountMinor: Minor | null;
  /** Change from the previous occurrence, in percent (null when there is no previous or it was zero). */
  deltaPct: number | null;
  lastDate: CalendarDate;
  occurrences: number;
}

export interface ProcessorClearing {
  /** "stripe", "shopify_payments"... */
  key: string;
  name: string;
  accountId: string;
  /** Money earned but not yet deposited (clearing balance). */
  balanceMinor: Minor;
  lastPayoutDate: CalendarDate | null;
  daysSinceLastPayout: number | null;
}

export interface ChannelSummary {
  id: string;
  name: string;
  kind: string;
}

export interface MetricsView {
  organizationId: string;
  currency: string;
  timezone: string;
  asOf: CalendarDate;
  computedAt: string;
  fingerprint: string;
  window: MetricWindow;
  prevWindow: MetricWindow;
  /** Distinct days with posted activity in the last 90 days. */
  dataDays: number;
  /** Under 14 data days: the brief is skipped and the Overview says so. */
  insufficientData: boolean;
  metrics: Metric[];
  channels: ChannelSummary[];
  recurring: RecurringCharge[];
  processors: ProcessorClearing[];
}

export const INSUFFICIENT_DATA_DAYS = 14;
/** Bump when a metric's definition, id, or label changes so stored snapshots are recomputed on the next read. */
export const METRICS_VERSION = 1;

// ---------------------------------------------------------------------------
// Formatting (the display strings the brief validator matches against)
// ---------------------------------------------------------------------------

export function displayFor(value: number | null, unit: MetricUnit, currency: string): string {
  if (value === null) return "n/a";
  switch (unit) {
    case "minor":
      return formatMoney(value, currency);
    case "percent":
      return `${value.toFixed(1)}%`;
    case "ratio":
      return `${value.toFixed(1)}x`;
    case "days":
      return `${Math.round(value)} ${Math.round(value) === 1 ? "day" : "days"}`;
    case "count":
      return String(value);
  }
}

const pct = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const ratio = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 10) / 10 : null);

/** Memo normalization for recurring-charge grouping: "CANVA *1234 09/12" and "CANVA" are one merchant. */
export function merchantSlug(memo: string): string {
  return memo
    .toUpperCase()
    .replace(/[0-9]+/g, " ")
    .replace(/[^A-Z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/ /g, "-");
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

interface AccountInfo {
  id: string;
  type: AccountType;
  systemKey: string | null;
  name: string;
}

interface Totals {
  revenue: Minor;
  refunds: Minor;
  fees: Minor;
  cogs: Minor;
  ads: Minor;
  opex: Minor;
  uncategorized: Minor;
}

const emptyTotals = (): Totals => ({ revenue: 0, refunds: 0, fees: 0, cogs: 0, ads: 0, opex: 0, uncategorized: 0 });

export function metricsService(db: Db) {
  const postedStatuses = [EntryStatus.POSTED, EntryStatus.REVERSED];

  async function fingerprint(organizationId: string): Promise<string> {
    const agg = await db.journalEntry.aggregate({ where: { organizationId }, _count: { _all: true }, _max: { updatedAt: true } });
    return `v${METRICS_VERSION}:${agg._count._all}:${agg._max.updatedAt?.toISOString() ?? "0"}`;
  }

  /** Net movement per (account, channel) inside a window; POSTED + REVERSED so reversals net to zero. */
  async function groupedSums(organizationId: string, window: MetricWindow) {
    return db.journalLine.groupBy({
      by: ["accountId", "channelId"],
      where: { organizationId, entry: { status: { in: postedStatuses }, date: { gte: calendarToDateColumn(window.from), lte: calendarToDateColumn(window.to) } } },
      _sum: { debitMinor: true, creditMinor: true },
    });
  }

  function bucketTotals(rows: Awaited<ReturnType<typeof groupedSums>>, accounts: Map<string, AccountInfo>): { blended: Totals; byChannel: Map<string, Totals> } {
    const blended = emptyTotals();
    const byChannel = new Map<string, Totals>();
    for (const r of rows) {
      const a = accounts.get(r.accountId);
      if (!a) continue;
      const debit = bigintToMinor(r._sum.debitMinor ?? 0n);
      const credit = bigintToMinor(r._sum.creditMinor ?? 0n);
      const netDebit = debit - credit;
      const netCredit = credit - debit;
      const apply = (t: Totals) => {
        if (a.type === AccountType.INCOME) {
          if (a.systemKey === "refunds") t.refunds += netDebit;
          else t.revenue += netCredit;
        } else if (a.type === AccountType.EXPENSE) {
          if (a.systemKey === "processor_fees") t.fees += netDebit;
          else if (a.systemKey === "cogs") t.cogs += netDebit;
          else if (a.systemKey === "advertising") t.ads += netDebit;
          else if (a.systemKey === "uncategorized") t.uncategorized += netDebit;
          else t.opex += netDebit;
        }
      };
      apply(blended);
      if (r.channelId) {
        if (!byChannel.has(r.channelId)) byChannel.set(r.channelId, emptyTotals());
        apply(byChannel.get(r.channelId)!);
      }
    }
    return { blended, byChannel };
  }

  async function bankFlow(organizationId: string, window: MetricWindow): Promise<{ inMinor: Minor; outMinor: Minor }> {
    const agg = await db.journalLine.aggregate({
      where: { organizationId, isBankSide: true, entry: { status: EntryStatus.POSTED, reversesEntryId: null, date: { gte: calendarToDateColumn(window.from), lte: calendarToDateColumn(window.to) } } },
      _sum: { debitMinor: true, creditMinor: true },
    });
    return { inMinor: bigintToMinor(agg._sum.debitMinor ?? 0n), outMinor: bigintToMinor(agg._sum.creditMinor ?? 0n) };
  }

  async function balance(organizationId: string, accountIds: string[]): Promise<Minor> {
    if (accountIds.length === 0) return 0;
    const agg = await db.journalLine.aggregate({ where: { organizationId, accountId: { in: accountIds }, entry: { status: { in: postedStatuses } } }, _sum: { debitMinor: true, creditMinor: true } });
    return bigintToMinor(agg._sum.debitMinor ?? 0n) - bigintToMinor(agg._sum.creditMinor ?? 0n);
  }

  /** Money-out bank rows over 90 days, grouped by merchant; ≥ 3 occurrences at a monthly or weekly rhythm. */
  async function detectRecurring(organizationId: string, window: MetricWindow): Promise<RecurringCharge[]> {
    const lines = await db.journalLine.findMany({
      where: { organizationId, isBankSide: true, creditMinor: { gt: 0 }, entry: { status: EntryStatus.POSTED, reversesEntryId: null, date: { gte: calendarToDateColumn(window.from), lte: calendarToDateColumn(window.to) } } },
      select: { creditMinor: true, entry: { select: { date: true, memo: true } } },
      orderBy: { entry: { date: "asc" } },
    });
    const groups = new Map<string, { memo: string; rows: { date: CalendarDate; amount: Minor }[] }>();
    for (const l of lines) {
      const slug = merchantSlug(l.entry.memo);
      if (!slug) continue;
      if (!groups.has(slug)) groups.set(slug, { memo: l.entry.memo, rows: [] });
      groups.get(slug)!.rows.push({ date: dateColumnToCalendar(l.entry.date), amount: bigintToMinor(l.creditMinor) });
    }
    const out: RecurringCharge[] = [];
    for (const [slug, g] of groups) {
      // One row per day per merchant (a daily ad spend is not a subscription).
      const byDay = new Map<CalendarDate, Minor>();
      for (const r of g.rows) byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.amount);
      const rows = [...byDay.entries()].map(([date, amount]) => ({ date, amount })).sort((a, b) => (a.date < b.date ? -1 : 1));
      if (rows.length < 3) continue;
      const gaps = rows.slice(1).map((r, i) => daysBetween(rows[i]!.date, r.date));
      const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!;
      const cadence = median >= 25 && median <= 35 ? "monthly" : median >= 6 && median <= 8 ? "weekly" : null;
      if (!cadence) continue;
      // Amounts must be stable-ish: the smallest is at least half the largest (excludes shipping labels).
      const amounts = rows.map((r) => r.amount);
      if (Math.min(...amounts) < Math.max(...amounts) / 2 && rows.length > 3) continue;
      const last = rows[rows.length - 1]!;
      const prev = rows[rows.length - 2]!;
      out.push({
        slug,
        memo: g.memo,
        cadence,
        amountMinor: last.amount,
        prevAmountMinor: prev.amount,
        deltaPct: prev.amount > 0 ? Math.round(((last.amount - prev.amount) / prev.amount) * 1000) / 10 : null,
        lastDate: last.date,
        occurrences: rows.length,
      });
    }
    return out.sort((a, b) => b.amountMinor - a.amountMinor);
  }

  async function processorClearing(organizationId: string, accounts: AccountInfo[], today: CalendarDate): Promise<ProcessorClearing[]> {
    const clearing = accounts.filter((a) => a.systemKey?.startsWith("clearing:"));
    const out: ProcessorClearing[] = [];
    for (const a of clearing) {
      const [bal, last] = await Promise.all([
        balance(organizationId, [a.id]),
        db.journalLine.findFirst({
          where: { organizationId, accountId: a.id, creditMinor: { gt: 0 }, entry: { status: EntryStatus.POSTED, reversesEntryId: null, source: "BANK" } },
          orderBy: { entry: { date: "desc" } },
          select: { entry: { select: { date: true } } },
        }),
      ]);
      const lastPayoutDate = last ? dateColumnToCalendar(last.entry.date) : null;
      out.push({
        key: a.systemKey!.slice("clearing:".length),
        name: a.name.replace(/ clearing$/i, ""),
        accountId: a.id,
        balanceMinor: bal,
        lastPayoutDate,
        daysSinceLastPayout: lastPayoutDate ? daysBetween(lastPayoutDate, today) : null,
      });
    }
    return out.sort((a, b) => b.balanceMinor - a.balanceMinor);
  }

  async function compute(organizationId: string, currency: string, timezone: string, now: Date = new Date()): Promise<MetricsView> {
    const window = lastNDays(30, timezone, now);
    const prevWindow = { from: addCalendarDays(window.from, -30), to: addCalendarDays(window.from, -1) };
    const window90 = lastNDays(90, timezone, now);
    const today = window.to;

    const [fp, accountRows, channelRows, rowsNow, rowsPrev, flowNow, flowPrev, activeDays, uncategorizedCount, recurring] = await Promise.all([
      fingerprint(organizationId),
      db.account.findMany({ where: { organizationId }, select: { id: true, type: true, systemKey: true, name: true } }),
      db.salesChannel.findMany({ where: { organizationId, isArchived: false }, select: { id: true, name: true, kind: true }, orderBy: { name: "asc" } }),
      groupedSums(organizationId, window),
      groupedSums(organizationId, prevWindow),
      bankFlow(organizationId, window),
      bankFlow(organizationId, prevWindow),
      db.journalEntry.groupBy({ by: ["date"], where: { organizationId, status: EntryStatus.POSTED, date: { gte: calendarToDateColumn(window90.from), lte: calendarToDateColumn(window90.to) } } }),
      db.journalEntry.count({ where: { organizationId, status: EntryStatus.POSTED, reversesEntryId: null, lines: { some: { isBankSide: false, account: { systemKey: "uncategorized" } } } } }),
      detectRecurring(organizationId, window90),
    ]);

    const accounts = new Map(accountRows.map((a) => [a.id, a]));
    const cashIds = accountRows.filter((a) => a.type === AccountType.ASSET && (a.systemKey === "cash" || a.systemKey?.startsWith("bank:"))).map((a) => a.id);
    const [cash, processors] = await Promise.all([balance(organizationId, cashIds), processorClearing(organizationId, accountRows, today)]);

    const now30 = bucketTotals(rowsNow, accounts);
    const prev30 = bucketTotals(rowsPrev, accounts);

    const metrics: Metric[] = [];
    const add = (id: string, label: string, value: number | null, unit: MetricUnit, win: MetricWindow | null, extra: Partial<Metric> = {}) => {
      metrics.push({ id, label, value, unit, display: displayFor(value, unit, currency), window: win, ...extra });
    };
    const withPrev = (value: number | null, unit: MetricUnit) => ({ prev: { value, display: displayFor(value, unit, currency) } });

    // Cash and burn
    add("cash_on_hand", "Cash on hand", cash, "minor", null);
    add("money_in_30d", "Money in", flowNow.inMinor, "minor", window, withPrev(flowPrev.inMinor, "minor"));
    add("money_out_30d", "Money out", flowNow.outMinor, "minor", window, withPrev(flowPrev.outMinor, "minor"));
    const netBurn = flowNow.outMinor - flowNow.inMinor;
    const prevBurn = flowPrev.outMinor - flowPrev.inMinor;
    add("net_burn_30d", "Net cash burn", netBurn, "minor", window, { ...withPrev(prevBurn, "minor"), note: netBurn > 0 ? "More left the bank than came in." : "Bank deposits covered what went out." });
    const runway = netBurn > 0 && cash > 0 ? Math.floor(cash / (netBurn / 30)) : null;
    add("runway_days", "Runway", runway, "days", window, { note: runway === null ? (cash <= 0 ? "No cash on hand." : "Not burning cash at the current rate.") : "At the last 30 days' net burn." });

    // Queue
    add("uncategorized_count", "Transactions needing a category", uncategorizedCount, "count", null);
    add("uncategorized_30d", "Uncategorized spend", now30.blended.uncategorized, "minor", window);

    // Margin (blended)
    const b = now30.blended;
    const pb = prev30.blended;
    const grossMargin = (t: Totals) => t.revenue - t.refunds - t.fees - t.cogs;
    add("revenue_30d", "Revenue", b.revenue, "minor", window, withPrev(pb.revenue, "minor"));
    add("refunds_30d", "Refunds", b.refunds, "minor", window, withPrev(pb.refunds, "minor"));
    add("processor_fees_30d", "Processor fees", b.fees, "minor", window, withPrev(pb.fees, "minor"));
    add("fee_rate_30d", "Effective fee rate", pct(b.fees, b.revenue), "percent", window, withPrev(pct(pb.fees, pb.revenue), "percent"));
    add("cogs_30d", "Cost of goods sold", b.cogs, "minor", window, withPrev(pb.cogs, "minor"));
    add("gross_margin_30d", "Gross margin", grossMargin(b), "minor", window, { ...withPrev(grossMargin(pb), "minor"), note: "Revenue minus refunds, processor fees, and COGS." });
    add("gross_margin_pct_30d", "Gross margin rate", pct(grossMargin(b), b.revenue), "percent", window, withPrev(pct(grossMargin(pb), pb.revenue), "percent"));
    add("ad_spend_30d", "Ad spend", b.ads, "minor", window, withPrev(pb.ads, "minor"));
    add("roas_30d", "Blended ROAS", ratio(b.revenue, b.ads), "ratio", window, { ...withPrev(ratio(pb.revenue, pb.ads), "ratio"), note: "Revenue divided by ad spend." });
    add("contribution_margin_30d", "Contribution margin", grossMargin(b) - b.ads, "minor", window, { ...withPrev(grossMargin(pb) - pb.ads, "minor"), note: "Gross margin minus ad spend." });
    add("operating_expenses_30d", "Other operating expenses", b.opex, "minor", window, withPrev(pb.opex, "minor"));

    // Per channel
    for (const c of channelRows) {
      const t = now30.byChannel.get(c.id) ?? emptyTotals();
      const p = prev30.byChannel.get(c.id) ?? emptyTotals();
      const idc = (k: string) => `channel:${c.id}:${k}`;
      const ext = { channelId: c.id };
      add(idc("revenue"), `${c.name} revenue`, t.revenue, "minor", window, { ...ext, ...withPrev(p.revenue, "minor") });
      add(idc("fees"), `${c.name} processor fees`, t.fees, "minor", window, { ...ext, ...withPrev(p.fees, "minor") });
      add(idc("fee_rate"), `${c.name} fee rate`, pct(t.fees, t.revenue), "percent", window, { ...ext, ...withPrev(pct(p.fees, p.revenue), "percent") });
      add(idc("cogs"), `${c.name} COGS`, t.cogs, "minor", window, { ...ext, ...withPrev(p.cogs, "minor") });
      add(idc("gross_margin"), `${c.name} gross margin`, grossMargin(t), "minor", window, { ...ext, ...withPrev(grossMargin(p), "minor") });
      add(idc("gross_margin_pct"), `${c.name} gross margin rate`, pct(grossMargin(t), t.revenue), "percent", window, { ...ext, ...withPrev(pct(grossMargin(p), p.revenue), "percent") });
      add(idc("ad_spend"), `${c.name} ad spend`, t.ads, "minor", window, { ...ext, ...withPrev(p.ads, "minor") });
      add(idc("roas"), `${c.name} ROAS`, ratio(t.revenue, t.ads), "ratio", window, { ...ext, ...withPrev(ratio(p.revenue, p.ads), "ratio") });
      add(idc("contribution_margin"), `${c.name} contribution margin`, grossMargin(t) - t.ads, "minor", window, { ...ext, ...withPrev(grossMargin(p) - p.ads, "minor") });
    }

    // Recurring charges
    const monthlyTotal = recurring.reduce((s, r) => s + (r.cadence === "monthly" ? r.amountMinor : Math.round(r.amountMinor * 4.33)), 0);
    add("recurring_monthly_total", "Recurring charges per month", monthlyTotal, "minor", window90, { note: `${recurring.length} recurring ${recurring.length === 1 ? "charge" : "charges"} detected over 90 days.` });
    for (const r of recurring) {
      add(`recurring:${r.slug}:amount`, `${r.memo} (${r.cadence})`, r.amountMinor, "minor", window90, { prev: { value: r.prevAmountMinor, display: displayFor(r.prevAmountMinor, "minor", currency) } });
      add(`recurring:${r.slug}:delta_pct`, `${r.memo} change vs previous charge`, r.deltaPct, "percent", window90);
    }

    // Processor clearing
    const clearingTotal = processors.reduce((s, p) => s + p.balanceMinor, 0);
    add("clearing_balance", "Earned, not yet deposited", clearingTotal, "minor", null, { note: "Sales sitting in processor clearing accounts awaiting payout." });
    for (const p of processors) {
      add(`clearing:${p.key}:balance`, `${p.name} awaiting payout`, p.balanceMinor, "minor", null);
      add(`clearing:${p.key}:days_since_payout`, `Days since last ${p.name} payout`, p.daysSinceLastPayout, "days", null, { note: p.lastPayoutDate ? `Last payout ${p.lastPayoutDate}.` : "No payout recorded yet." });
    }

    const dataDays = activeDays.length;
    return {
      organizationId,
      currency,
      timezone,
      asOf: today,
      computedAt: now.toISOString(),
      fingerprint: fp,
      window,
      prevWindow,
      dataDays,
      insufficientData: dataDays < INSUFFICIENT_DATA_DAYS,
      metrics,
      channels: channelRows.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
      recurring,
      processors,
    };
  }

  return {
    compute,

    /** Today's snapshot, recomputed only when the ledger changed since it was stored. */
    async get(organizationId: string, currency: string, timezone: string, now: Date = new Date()): Promise<MetricsView> {
      const today = lastNDays(1, timezone, now).to;
      const asOf = calendarToDateColumn(today);
      const [existing, fp] = await Promise.all([db.metricsSnapshot.findUnique({ where: { organizationId_asOf: { organizationId, asOf } } }), fingerprint(organizationId)]);
      if (existing && existing.fingerprint === fp) return existing.payload as unknown as MetricsView;
      const view = await compute(organizationId, currency, timezone, now);
      const payload = view as unknown as Prisma.InputJsonValue;
      await db.metricsSnapshot.upsert({
        where: { organizationId_asOf: { organizationId, asOf } },
        create: { organizationId, asOf, fingerprint: view.fingerprint, payload },
        update: { fingerprint: view.fingerprint, payload },
      });
      return view;
    },

    /** Look a metric up by id (the brief validator and tests). */
    find(view: MetricsView, id: string): Metric | undefined {
      return view.metrics.find((m) => m.id === id);
    },
  };
}

export type MetricsService = ReturnType<typeof metricsService>;
