import { assertSafeMinor, bigintToMinor, calendarToDateColumn, dateColumnToCalendar, type CalendarDate, type Minor } from "@ledgeriq/shared";
import { serializable, type Db, type Tx } from "../../db/prisma.js";
import { EntryStatus } from "../../generated/prisma/enums.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { CrossOrgReferenceError, EntryLockedError, EntryNotFoundError, InvalidLineError, InvalidTransitionError, StaleVersionError, UnbalancedEntryError } from "./errors.js";
import type { Actor, LedgerEntry, LedgerLine, LineInput, PostEntryInput, RecategorizeInput, ReverseEntryInput } from "./types.js";

/**
 * JournalEntry lifecycle (ADR 0004):
 *
 *   post ──▶ POSTED(unlocked) ──recategorize (in place, audited)──┐
 *                │                                              │
 *                │ lock (reconcile / close period)              ▼
 *                ▼                                        POSTED(unlocked)
 *           POSTED(locked) ──reverse──▶ REVERSED  +  mirror entry (reversesEntryId)
 *
 *   Unlocked POSTED entries may also be reversed. Locked entries accept no
 *   change except reverse. Bank-side lines never change after post. The
 *   database enforces: one positive side per line, balanced POSTED entries
 *   (deferred trigger), and the locked/bank-side rules (triggers).
 */

const entryInclude = { lines: { orderBy: { position: "asc" } } } satisfies Prisma.JournalEntryInclude;
type EntryRow = Prisma.JournalEntryGetPayload<{ include: typeof entryInclude }>;

// ---------------------------------------------------------------------------
// Post
// ---------------------------------------------------------------------------

export async function postEntry(db: Db, input: PostEntryInput): Promise<LedgerEntry> {
  return serializable(db, (tx) => postEntryTx(tx, input));
}

export async function postEntryTx(tx: Tx, input: PostEntryInput): Promise<LedgerEntry> {
  const org = await tx.organization.findUnique({ where: { id: input.organizationId }, select: { currency: true } });
  if (!org) throw new CrossOrgReferenceError("Organization");

  const normalized = normalizeLines(input.lines);
  await assertAccountsAndChannelsBelong(tx, input.organizationId, normalized);

  const debits = normalized.reduce((s, l) => s + l.debitMinor, 0n);
  const credits = normalized.reduce((s, l) => s + l.creditMinor, 0n);
  if (debits !== credits) throw new UnbalancedEntryError(debits, credits);

  const entry = await tx.journalEntry.create({
    data: {
      organizationId: input.organizationId,
      date: calendarToDateColumn(input.date),
      memo: input.memo ?? "",
      status: EntryStatus.POSTED,
      source: input.source,
      externalRef: input.externalRef ?? null,
      createdById: input.actor?.userId ?? null,
      lines: {
        create: normalized.map((l, position) => ({
          organizationId: input.organizationId,
          accountId: l.accountId,
          debitMinor: l.debitMinor,
          creditMinor: l.creditMinor,
          currency: org.currency,
          channelId: l.channelId,
          isBankSide: l.isBankSide,
          memo: l.memo,
          position,
        })),
      },
    },
    include: entryInclude,
  });

  const view = toView(entry);
  await audit(tx, input.organizationId, input.actor, "entry.post", entry.id, null, view);
  return view;
}

// ---------------------------------------------------------------------------
// Reverse
// ---------------------------------------------------------------------------

export async function reverseEntry(db: Db, input: ReverseEntryInput): Promise<{ original: LedgerEntry; reversal: LedgerEntry }> {
  return serializable(db, (tx) => reverseEntryTx(tx, input));
}

export async function reverseEntryTx(tx: Tx, input: ReverseEntryInput): Promise<{ original: LedgerEntry; reversal: LedgerEntry }> {
  const entry = await loadEntry(tx, input.organizationId, input.entryId);
  if (entry.status !== EntryStatus.POSTED) throw new InvalidTransitionError(`Only posted entries can be reversed (entry is ${entry.status})`);
  const alreadyReversed = await tx.journalEntry.findUnique({ where: { reversesEntryId: entry.id }, select: { id: true } });
  if (alreadyReversed) throw new InvalidTransitionError("This entry was already reversed");

  const reversal = await tx.journalEntry.create({
    data: {
      organizationId: entry.organizationId,
      date: input.date ? calendarToDateColumn(input.date) : entry.date,
      memo: input.memo ?? `Reversal of: ${entry.memo}`.trim(),
      status: EntryStatus.POSTED,
      source: entry.source,
      reversesEntryId: entry.id,
      createdById: input.actor?.userId ?? null,
      lines: {
        create: entry.lines.map((l) => ({
          organizationId: l.organizationId,
          accountId: l.accountId,
          debitMinor: l.creditMinor,
          creditMinor: l.debitMinor,
          currency: l.currency,
          channelId: l.channelId,
          isBankSide: l.isBankSide,
          memo: l.memo,
          position: l.position,
        })),
      },
    },
    include: entryInclude,
  });

  // The only update a locked entry accepts (DB trigger allows status → REVERSED).
  const original = await tx.journalEntry.update({
    where: { id: entry.id },
    data: { status: EntryStatus.REVERSED, version: { increment: 1 } },
    include: entryInclude,
  });

  const before = toView(entry);
  const originalView = toView(original);
  const reversalView = toView(reversal);
  await audit(tx, entry.organizationId, input.actor, "entry.reverse", entry.id, before, originalView);
  await audit(tx, entry.organizationId, input.actor, "entry.post", reversal.id, null, reversalView);
  return { original: originalView, reversal: reversalView };
}

// ---------------------------------------------------------------------------
// Recategorize (in place while unlocked; supports splits)
// ---------------------------------------------------------------------------

export async function recategorizeEntry(db: Db, input: RecategorizeInput): Promise<LedgerEntry> {
  return serializable(db, (tx) => recategorizeEntryTx(tx, input));
}

export async function recategorizeEntryTx(tx: Tx, input: RecategorizeInput): Promise<LedgerEntry> {
  const entry = await loadEntry(tx, input.organizationId, input.entryId);
  if (entry.status !== EntryStatus.POSTED) throw new InvalidTransitionError(`Only posted entries can be recategorized (entry is ${entry.status})`);
  if (entry.locked) throw new EntryLockedError();
  if (entry.version !== input.expectedVersion) throw new StaleVersionError();

  const bankLines = entry.lines.filter((l) => l.isBankSide);
  if (bankLines.length !== 1) throw new InvalidTransitionError("Recategorize applies to entries with exactly one bank-side line; use reverse and re-post for others");
  const bank = bankLines[0]!;
  const bankAmount = bank.debitMinor > 0n ? bank.debitMinor : bank.creditMinor;
  const offsetsGoOnCredit = bank.debitMinor > 0n; // money in → bank debited → offsets are credits

  if (input.offsets.length === 0) throw new InvalidLineError("At least one offset line is required", "offsets");
  const offsetLines: LineInput[] = input.offsets.map((o) => {
    const amount = assertSafeMinor(o.amountMinor, "amountMinor");
    if (amount <= 0) throw new InvalidLineError("Offset amounts must be positive", "offsets.amountMinor");
    return {
      accountId: o.accountId,
      channelId: o.channelId ?? null,
      memo: o.memo ?? null,
      ...(offsetsGoOnCredit ? { creditMinor: amount } : { debitMinor: amount }),
    };
  });
  const normalized = normalizeLines(offsetLines, { allowSingle: true });
  await assertAccountsAndChannelsBelong(tx, entry.organizationId, normalized);
  const offsetTotal = normalized.reduce((s, l) => s + l.debitMinor + l.creditMinor, 0n);
  if (offsetTotal !== bankAmount) {
    throw new InvalidLineError(`Offsets total ${offsetTotal} minor units but the bank line is ${bankAmount}`, "offsets");
  }

  const before = toView(entry);
  await tx.journalLine.deleteMany({ where: { entryId: entry.id, isBankSide: false } });
  await tx.journalLine.createMany({
    data: normalized.map((l, i) => ({
      entryId: entry.id,
      organizationId: entry.organizationId,
      accountId: l.accountId,
      debitMinor: l.debitMinor,
      creditMinor: l.creditMinor,
      currency: bank.currency,
      channelId: l.channelId,
      isBankSide: false,
      memo: l.memo,
      position: i + 1,
    })),
  });
  // Bank line keeps position 0 so the view is stable.
  await tx.journalLine.update({ where: { id: bank.id }, data: { position: 0 } });
  const updated = await tx.journalEntry.update({
    where: { id: entry.id },
    data: { version: { increment: 1 } },
    include: entryInclude,
  });
  const after = toView(updated);
  await audit(tx, entry.organizationId, input.actor, "entry.recategorize", entry.id, before, after);
  return after;
}

// ---------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------

export async function lockEntries(db: Db, organizationId: string, entryIds: string[], actor?: Actor): Promise<number> {
  return serializable(db, async (tx) => {
    const rows = await tx.journalEntry.findMany({ where: { organizationId, id: { in: entryIds }, status: EntryStatus.POSTED, locked: false }, select: { id: true } });
    if (rows.length === 0) return 0;
    const ids = rows.map((r) => r.id);
    await tx.journalEntry.updateMany({ where: { id: { in: ids } }, data: { locked: true } });
    for (const id of ids) await audit(tx, organizationId, actor, "entry.lock", id, { locked: false }, { locked: true });
    return ids.length;
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getEntry(db: Db | Tx, organizationId: string, entryId: string): Promise<LedgerEntry> {
  return toView(await loadEntry(db, organizationId, entryId));
}

export interface TrialBalanceRow {
  accountId: string;
  code: string | null;
  name: string;
  type: string;
  debitMinor: Minor;
  creditMinor: Minor;
  /** Debit-normal accounts (asset, expense): debit - credit. Credit-normal: credit - debit. */
  balanceMinor: Minor;
}

/**
 * Balances of every account from entries on the books (POSTED and REVERSED:
 * a reversed entry and its mirror both stay in the ledger and net to zero)
 * dated on or before `asOf`. Debits always equal credits in total.
 */
export async function trialBalance(db: Db | Tx, organizationId: string, asOf?: CalendarDate): Promise<{ rows: TrialBalanceRow[]; totalDebitMinor: Minor; totalCreditMinor: Minor }> {
  const grouped = await db.journalLine.groupBy({
    by: ["accountId"],
    where: {
      organizationId,
      entry: { status: { in: [EntryStatus.POSTED, EntryStatus.REVERSED] }, ...(asOf ? { date: { lte: calendarToDateColumn(asOf) } } : {}) },
    },
    _sum: { debitMinor: true, creditMinor: true },
  });
  const accounts = await db.account.findMany({ where: { organizationId }, orderBy: [{ code: "asc" }, { name: "asc" }] });
  const byId = new Map(grouped.map((g) => [g.accountId, g._sum]));
  const rows: TrialBalanceRow[] = accounts.map((a) => {
    const sums = byId.get(a.id);
    const debit = bigintToMinor(sums?.debitMinor ?? 0n);
    const credit = bigintToMinor(sums?.creditMinor ?? 0n);
    const debitNormal = a.type === "ASSET" || a.type === "EXPENSE";
    return { accountId: a.id, code: a.code, name: a.name, type: a.type, debitMinor: debit, creditMinor: credit, balanceMinor: debitNormal ? debit - credit : credit - debit };
  });
  const totalDebitMinor = rows.reduce((s, r) => s + r.debitMinor, 0);
  const totalCreditMinor = rows.reduce((s, r) => s + r.creditMinor, 0);
  return { rows, totalDebitMinor, totalCreditMinor };
}

export async function accountBalance(db: Db | Tx, organizationId: string, accountId: string, asOf?: CalendarDate): Promise<Minor> {
  const tb = await trialBalance(db, organizationId, asOf);
  const row = tb.rows.find((r) => r.accountId === accountId);
  if (!row) throw new CrossOrgReferenceError("Account");
  return row.balanceMinor;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface NormalizedLine {
  accountId: string;
  debitMinor: bigint;
  creditMinor: bigint;
  channelId: string | null;
  isBankSide: boolean;
  memo: string | null;
}

function normalizeLines(lines: LineInput[], opts: { allowSingle?: boolean } = {}): NormalizedLine[] {
  if (!Array.isArray(lines) || lines.length < (opts.allowSingle ? 1 : 2)) {
    throw new InvalidLineError("An entry needs at least two lines", "lines");
  }
  return lines.map((l, i) => {
    const debit = l.debitMinor === undefined ? 0 : assertSafeMinor(l.debitMinor, `lines[${i}].debitMinor`);
    const credit = l.creditMinor === undefined ? 0 : assertSafeMinor(l.creditMinor, `lines[${i}].creditMinor`);
    if (debit < 0 || credit < 0) throw new InvalidLineError("Amounts must not be negative; use the other side", `lines[${i}]`);
    if ((debit > 0) === (credit > 0)) throw new InvalidLineError("Each line needs exactly one of debitMinor or creditMinor greater than zero", `lines[${i}]`);
    if (!l.accountId) throw new InvalidLineError("accountId is required", `lines[${i}].accountId`);
    return {
      accountId: l.accountId,
      debitMinor: BigInt(debit),
      creditMinor: BigInt(credit),
      channelId: l.channelId ?? null,
      isBankSide: l.isBankSide ?? false,
      memo: l.memo ?? null,
    };
  });
}

async function assertAccountsAndChannelsBelong(tx: Tx, organizationId: string, lines: NormalizedLine[]): Promise<void> {
  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await tx.account.findMany({ where: { organizationId, id: { in: accountIds } }, select: { id: true, isArchived: true } });
  if (accounts.length !== accountIds.length) throw new CrossOrgReferenceError("Account");
  const archived = accounts.find((a) => a.isArchived);
  if (archived) throw new InvalidLineError("Cannot post to an archived account", "lines.accountId");

  const channelIds = [...new Set(lines.map((l) => l.channelId).filter((c): c is string => !!c))];
  if (channelIds.length > 0) {
    const channels = await tx.salesChannel.count({ where: { organizationId, id: { in: channelIds } } });
    if (channels !== channelIds.length) throw new CrossOrgReferenceError("Sales channel");
  }
}

async function loadEntry(db: Db | Tx, organizationId: string, entryId: string): Promise<EntryRow> {
  const entry = await db.journalEntry.findFirst({ where: { id: entryId, organizationId }, include: entryInclude });
  if (!entry) throw new EntryNotFoundError();
  return entry;
}

function toView(e: EntryRow): LedgerEntry {
  const lines: LedgerLine[] = e.lines.map((l) => ({
    id: l.id,
    accountId: l.accountId,
    debitMinor: bigintToMinor(l.debitMinor),
    creditMinor: bigintToMinor(l.creditMinor),
    currency: l.currency,
    channelId: l.channelId,
    isBankSide: l.isBankSide,
    memo: l.memo,
    position: l.position,
  }));
  return {
    id: e.id,
    organizationId: e.organizationId,
    date: dateColumnToCalendar(e.date),
    memo: e.memo,
    status: e.status,
    locked: e.locked,
    source: e.source,
    externalRef: e.externalRef,
    reversesEntryId: e.reversesEntryId,
    version: e.version,
    lines,
  };
}

async function audit(tx: Tx, organizationId: string, actor: Actor | undefined, action: string, entityId: string, before: unknown, after: unknown): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId,
      actorUserId: actor?.userId ?? null,
      requestId: actor?.requestId ?? null,
      action,
      entityType: "JournalEntry",
      entityId,
      before: before === null ? undefined : (before as Prisma.InputJsonValue),
      after: after === null ? undefined : (after as Prisma.InputJsonValue),
    },
  });
}

