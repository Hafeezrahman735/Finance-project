import { assertCalendarDate, bigintToMinor, calendarToDateColumn, dateColumnToCalendar, type CalendarDate, type Minor } from "@ledgeriq/shared";
import { z } from "zod";
import { serializable, type Db } from "../../db/prisma.js";
import { EntrySource, EntryStatus } from "../../generated/prisma/enums.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import { systemAccount } from "../ledger/chart.js";
import { EntryNotFoundError, InvalidTransitionError } from "../ledger/errors.js";
import { postEntryTx, recategorizeEntry, reverseEntry, reverseEntryTx } from "../ledger/ledger.js";
import type { Actor, LedgerEntry } from "../ledger/types.js";

/**
 * "Transactions" is the user's view of the ledger: one row per entry with a
 * bank-side line, shown as money in / money out with a category. Every
 * function is organization-scoped by its first argument (ADR 0003); nothing
 * here queries without `organizationId`.
 */

export interface TransactionLine {
  accountId: string;
  accountName: string;
  amountMinor: Minor;
  channelId: string | null;
}

export interface TransactionView {
  id: string;
  date: CalendarDate;
  memo: string;
  direction: "in" | "out";
  amountMinor: Minor;
  currency: string;
  bankAccount: { id: string; name: string };
  /** The non-bank side. One line normally; several for a split. */
  lines: TransactionLine[];
  /** First line's account name, or "Split" when there are several. */
  categoryName: string;
  uncategorized: boolean;
  status: EntryStatus;
  locked: boolean;
  source: EntrySource;
  version: number;
  reversesEntryId: string | null;
}

export const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  direction: z.enum(["in", "out"]).optional(),
  status: z.enum(["uncategorized", "all"]).default("all"),
  from: z.string().optional(),
  to: z.string().optional(),
  /** Include reversed entries and reversals (hidden by default: they net to zero). */
  includeReversed: z.coerce.boolean().default(false),
});

export const createSchema = z.object({
  direction: z.enum(["in", "out"]),
  amountMinor: z.number().int().positive("must be greater than 0"),
  date: z.string().refine((d) => /^\d{4}-\d{2}-\d{2}$/.test(d), "must be YYYY-MM-DD"),
  memo: z.string().trim().max(500).default(""),
  /** Category account. Defaults to Uncategorized. */
  accountId: z.string().uuid().optional(),
  /** Bank/cash account. Defaults to the Cash system account. */
  bankAccountId: z.string().uuid().optional(),
  channelId: z.string().uuid().optional(),
});

export const updateSchema = z
  .object({
    version: z.number().int().positive(),
    /** Recategorize (or split): replaces the non-bank side. */
    lines: z.array(z.object({ accountId: z.string().uuid(), amountMinor: z.number().int().positive(), channelId: z.string().uuid().nullable().optional(), memo: z.string().max(500).nullable().optional() })).min(1).optional(),
    /** Manual entries only: replaces the whole entry (reverse + re-post). */
    amountMinor: z.number().int().positive().optional(),
    date: z.string().refine((d) => /^\d{4}-\d{2}-\d{2}$/.test(d), "must be YYYY-MM-DD").optional(),
    memo: z.string().trim().max(500).optional(),
    direction: z.enum(["in", "out"]).optional(),
  })
  .refine((v) => v.lines !== undefined || v.amountMinor !== undefined || v.date !== undefined || v.memo !== undefined || v.direction !== undefined, { message: "nothing to update" });

type ListQuery = z.infer<typeof listQuerySchema>;

const include = { lines: { orderBy: { position: "asc" }, include: { account: { select: { name: true, systemKey: true } } } } } satisfies Prisma.JournalEntryInclude;
type Row = Prisma.JournalEntryGetPayload<{ include: typeof include }>;

export function transactionsService(db: Db) {
  return {
    async list(organizationId: string, q: ListQuery): Promise<{ data: TransactionView[]; nextCursor: string | null }> {
      // Several `lines.some` conditions must be ANDed explicitly; object spread would overwrite them.
      const conditions: Prisma.JournalEntryWhereInput[] = [
        { organizationId },
        { lines: { some: { isBankSide: true } } },
      ];
      if (!q.includeReversed) conditions.push({ status: EntryStatus.POSTED, reversesEntryId: null });
      if (q.from) conditions.push({ date: { gte: calendarToDateColumn(assertCalendarDate(q.from, "from")) } });
      if (q.to) conditions.push({ date: { lte: calendarToDateColumn(assertCalendarDate(q.to, "to")) } });
      if (q.status === "uncategorized") conditions.push({ lines: { some: { isBankSide: false, account: { systemKey: "uncategorized" } } } });
      if (q.direction) conditions.push({ lines: { some: { isBankSide: true, ...(q.direction === "in" ? { debitMinor: { gt: 0 } } : { creditMinor: { gt: 0 } }) } } });
      // Keyset cursor on (date desc, id desc) so live imports cannot shift pages (CEO review 1.2).
      const cursor = q.cursor ? decodeCursor(q.cursor) : null;
      if (cursor) conditions.push({ OR: [{ date: { lt: cursor.date } }, { date: cursor.date, id: { lt: cursor.id } }] });
      const rows = await db.journalEntry.findMany({
        where: { AND: conditions },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        take: q.limit + 1,
        include,
      });
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        data: page.map(toView),
        nextCursor: rows.length > q.limit && last ? encodeCursor(last.date, last.id) : null,
      };
    },

    async get(organizationId: string, id: string): Promise<TransactionView> {
      const row = await db.journalEntry.findFirst({ where: { id, organizationId }, include });
      if (!row) throw new EntryNotFoundError();
      return toView(row);
    },

    /** Manual money in / money out against a bank account (defaults to Cash). */
    async create(organizationId: string, input: z.infer<typeof createSchema>, actor: Actor): Promise<TransactionView> {
      const entry = await serializable(db, async (tx) => {
        const bank = input.bankAccountId ?? (await systemAccount(tx, organizationId, "cash")).id;
        const category = input.accountId ?? (await systemAccount(tx, organizationId, "uncategorized")).id;
        const bankLine = input.direction === "in" ? { accountId: bank, debitMinor: input.amountMinor, isBankSide: true } : { accountId: bank, creditMinor: input.amountMinor, isBankSide: true };
        const offset = input.direction === "in" ? { accountId: category, creditMinor: input.amountMinor, channelId: input.channelId ?? null } : { accountId: category, debitMinor: input.amountMinor, channelId: input.channelId ?? null };
        return postEntryTx(tx, { organizationId, date: input.date, memo: input.memo, source: EntrySource.MANUAL, lines: [bankLine, offset], actor });
      });
      return this.get(organizationId, entry.id);
    },

    /**
     * Two update shapes:
     *  - `lines`: recategorize / split in place (any source, unlocked entries).
     *  - amount / date / memo / direction: manual entries only; the original is
     *    reversed and a corrected entry posted (bank-side lines are immutable, ADR 0004).
     * Returns the entry the client should now hold (a new id in the second case).
     */
    async update(organizationId: string, id: string, input: z.infer<typeof updateSchema>, actor: Actor): Promise<TransactionView> {
      if (input.lines) {
        const updated = await recategorizeEntry(db, { organizationId, entryId: id, expectedVersion: input.version, offsets: input.lines, actor });
        return this.get(organizationId, updated.id);
      }
      const current = await db.journalEntry.findFirst({ where: { id, organizationId }, include });
      if (!current) throw new EntryNotFoundError();
      if (current.source !== EntrySource.MANUAL) {
        throw new InvalidTransitionError("Only manually entered transactions can change amount or date; imported rows mirror the bank");
      }
      if (current.version !== input.version) throw new ValidationError("This transaction changed since you loaded it; refresh and try again", "version");
      const view = toView(current);
      const direction = input.direction ?? view.direction;
      const amount = input.amountMinor ?? view.amountMinor;
      const replacement = await serializable(db, async (tx) => {
        await reverseEntryTx(tx, { organizationId, entryId: id, memo: `Corrected: ${view.memo}`, actor });
        const offsets = view.lines.length === 1 && input.amountMinor === undefined ? view.lines : [{ ...view.lines[0]!, amountMinor: amount }];
        const bankLine = direction === "in" ? { accountId: view.bankAccount.id, debitMinor: amount, isBankSide: true } : { accountId: view.bankAccount.id, creditMinor: amount, isBankSide: true };
        const offsetLines = offsets.map((l) => (direction === "in" ? { accountId: l.accountId, creditMinor: l.amountMinor, channelId: l.channelId } : { accountId: l.accountId, debitMinor: l.amountMinor, channelId: l.channelId }));
        return postEntryTx(tx, { organizationId, date: input.date ?? view.date, memo: input.memo ?? view.memo, source: EntrySource.MANUAL, lines: [bankLine, ...offsetLines], actor });
      });
      return this.get(organizationId, replacement.id);
    },

    /** "Delete" in the UI: posted entries are never deleted, they are reversed. */
    async reverse(organizationId: string, id: string, actor: Actor): Promise<{ original: LedgerEntry; reversal: LedgerEntry }> {
      return reverseEntry(db, { organizationId, entryId: id, actor });
    },

    async accounts(organizationId: string) {
      return db.account.findMany({ where: { organizationId, isArchived: false }, orderBy: [{ type: "asc" }, { code: "asc" }, { name: "asc" }], select: { id: true, name: true, code: true, type: true, systemKey: true } });
    },
  };
}

export type TransactionsService = ReturnType<typeof transactionsService>;

function toView(row: Row): TransactionView {
  const bank = row.lines.find((l) => l.isBankSide);
  if (!bank) throw new NotFoundError("Not a bank transaction", "not_a_transaction");
  const direction: "in" | "out" = bank.debitMinor > 0n ? "in" : "out";
  const others = row.lines.filter((l) => !l.isBankSide);
  const lines: TransactionLine[] = others.map((l) => ({ accountId: l.accountId, accountName: l.account.name, amountMinor: bigintToMinor(l.debitMinor > 0n ? l.debitMinor : l.creditMinor), channelId: l.channelId }));
  return {
    id: row.id,
    date: dateColumnToCalendar(row.date),
    memo: row.memo,
    direction,
    amountMinor: bigintToMinor(bank.debitMinor > 0n ? bank.debitMinor : bank.creditMinor),
    currency: bank.currency,
    bankAccount: { id: bank.accountId, name: bank.account.name },
    lines,
    categoryName: lines.length === 1 ? lines[0]!.accountName : lines.length === 0 ? "" : "Split",
    uncategorized: others.some((l) => l.account.systemKey === "uncategorized"),
    status: row.status,
    locked: row.locked,
    source: row.source,
    version: row.version,
    reversesEntryId: row.reversesEntryId,
  };
}

function encodeCursor(date: Date, id: string): string {
  return Buffer.from(`${dateColumnToCalendar(date)}|${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { date: Date; id: string } {
  const [d, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!d || !id || !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new ValidationError("Invalid cursor", "cursor");
  return { date: calendarToDateColumn(d), id };
}
