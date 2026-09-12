import type { CalendarDate, Minor } from "@ledgeriq/shared";
import type { EntrySource, EntryStatus } from "../../generated/prisma/enums.js";

/** Who is acting, for the audit log and request correlation. */
export interface Actor {
  userId?: string | null;
  requestId?: string | null;
}

/** One side of an entry as callers write it: exactly one of debit/credit must be a positive integer. */
export interface LineInput {
  accountId: string;
  debitMinor?: Minor;
  creditMinor?: Minor;
  channelId?: string | null;
  isBankSide?: boolean;
  memo?: string | null;
}

export interface PostEntryInput {
  organizationId: string;
  date: CalendarDate;
  memo?: string;
  source: EntrySource;
  /** Idempotency key from the source system; unique per (organization, source). */
  externalRef?: string | null;
  lines: LineInput[];
  actor?: Actor;
}

/** Offsets for recategorization: the non-bank side of an entry, in minor units, same sign convention as the bank line's opposite. */
export interface OffsetInput {
  accountId: string;
  amountMinor: Minor;
  channelId?: string | null;
  memo?: string | null;
}

export interface RecategorizeInput {
  organizationId: string;
  entryId: string;
  /** The version the client loaded; mismatches raise StaleVersionError (two-tab edits). */
  expectedVersion: number;
  offsets: OffsetInput[];
  actor?: Actor;
}

export interface ReverseEntryInput {
  organizationId: string;
  entryId: string;
  /** Defaults to the original entry's date. */
  date?: CalendarDate;
  memo?: string;
  actor?: Actor;
}

/** Plain, wire-safe view of an entry (bigint → number). */
export interface LedgerLine {
  id: string;
  accountId: string;
  debitMinor: Minor;
  creditMinor: Minor;
  currency: string;
  channelId: string | null;
  isBankSide: boolean;
  memo: string | null;
  position: number;
}

export interface LedgerEntry {
  id: string;
  organizationId: string;
  date: CalendarDate;
  memo: string;
  status: EntryStatus;
  locked: boolean;
  source: EntrySource;
  externalRef: string | null;
  reversesEntryId: string | null;
  version: number;
  lines: LedgerLine[];
}
