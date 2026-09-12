import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { toMinor, type CalendarDate, type Minor } from "@ledgeriq/shared";
import { isValid, parse as parseDate } from "date-fns";
import { z } from "zod";

/**
 * CSV statement parsing (plan 1.4, design spec §3, eng review F6).
 *
 *   parseCsv      bytes → { columns, rows }   BOM, CRLF, quotes, delimiter sniffing
 *   guessMapping  headers + sample → best guess for the four questions
 *   applyMapping  rows + mapping → normalized rows (date, description, signed minor amount) or a problem per row
 *   dedupeHash    (bankAccount, date, amount, normalized description, occurrence) → stable key
 *
 * The mapper asks exactly four questions: date, description, amount (or a
 * debit + credit pair), and how sign is expressed. Everything else is hidden.
 */

export interface ParsedCsv {
  columns: string[];
  rows: Record<string, string>[];
  delimiter: string;
}

export const MAX_ROWS = 50_000;

export function parseCsv(input: Buffer | string): ParsedCsv {
  let text = Buffer.isBuffer(input) ? input.toString("utf8") : input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const delimiter = sniffDelimiter(text);
  const records = parse(text, {
    delimiter,
    bom: true,
    columns: (header: string[]) => header.map((h, i) => (h?.trim() ? h.trim() : `column_${i + 1}`)),
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: true,
  }) as Record<string, string>[];
  if (records.length > MAX_ROWS) throw new CsvError(`This file has more than ${MAX_ROWS.toLocaleString()} rows; split it and import in parts`, "too_many_rows");
  const columns = records.length ? Object.keys(records[0]!) : headerOnly(text, delimiter);
  return { columns, rows: records, delimiter };
}

export class CsvError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "CsvError";
  }
}

function sniffDelimiter(text: string): string {
  const head = text.split(/\r?\n/, 5).join("\n");
  const counts = [",", ";", "\t", "|"].map((d) => ({ d, n: (head.match(new RegExp(`\\${d}`, "g")) ?? []).length }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0]!.n > 0 ? counts[0]!.d : ",";
}

function headerOnly(text: string, delimiter: string): string[] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  return first.split(delimiter).map((h, i) => (h.trim().replace(/^"|"$/g, "") || `column_${i + 1}`));
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

export const DATE_FORMATS = ["auto", "YMD", "MDY", "DMY"] as const;
export const SIGN_CONVENTIONS = ["negativeIsOut", "positiveIsOut"] as const;

export const mappingSchema = z
  .object({
    dateColumn: z.string().min(1),
    descriptionColumn: z.string().min(1),
    amountColumn: z.string().min(1).optional(),
    debitColumn: z.string().min(1).optional(),
    creditColumn: z.string().min(1).optional(),
    dateFormat: z.enum(DATE_FORMATS).default("auto"),
    /** negativeIsOut: bank exports (−12.34 = money out). positiveIsOut: card statements (12.34 = a charge). Ignored for debit/credit pairs. */
    signConvention: z.enum(SIGN_CONVENTIONS).default("negativeIsOut"),
  })
  .refine((m) => (m.amountColumn ? true : Boolean(m.debitColumn && m.creditColumn)), { message: "Choose an amount column, or both a debit and a credit column", path: ["amountColumn"] });

export type Mapping = z.infer<typeof mappingSchema>;

export interface MappingGuess {
  mapping: Partial<Mapping>;
  /** Column → first three non-empty values, the "proof" shown under each question. */
  evidence: Record<string, string[]>;
  /** True when the sample has a day > 12 in both positions, i.e. the format could not be inferred. */
  dateAmbiguous: boolean;
}

const DATE_HEADERS = /^(date|posted|posting date|transaction date|trans date|booking date|value date|effective date|time)$/i;
const DESC_HEADERS = /^(description|memo|details|narrative|payee|name|merchant|transaction|particulars|reference|remarks)$/i;
const AMOUNT_HEADERS = /^(amount|transaction amount|amt|value|sum)$/i;
const DEBIT_HEADERS = /^(debit|debits|withdrawal|withdrawals|money out|paid out|out|charge)$/i;
const CREDIT_HEADERS = /^(credit|credits|deposit|deposits|money in|paid in|in|payment)$/i;

export function guessMapping(columns: string[], rows: Record<string, string>[]): MappingGuess {
  const sample = rows.slice(0, 200);
  const evidence: Record<string, string[]> = {};
  for (const c of columns) evidence[c] = sample.map((r) => r[c] ?? "").filter((v) => v !== "").slice(0, 3);

  const byHeader = (re: RegExp) => columns.find((c) => re.test(c.trim()));
  const looksLikeDate = (c: string) => sample.filter((r) => r[c]).slice(0, 20).every((r) => parseAnyDate(r[c]!, "auto") !== null);
  const looksLikeAmount = (c: string) => {
    const vals = sample.map((r) => r[c]).filter((v) => v && v.trim() !== "");
    return vals.length > 0 && vals.slice(0, 20).every((v) => safeToMinor(v!) !== null);
  };

  const mapping: Partial<Mapping> = {};
  mapping.dateColumn = byHeader(DATE_HEADERS) ?? columns.find(looksLikeDate);
  const debit = byHeader(DEBIT_HEADERS);
  const credit = byHeader(CREDIT_HEADERS);
  // Named debit/credit headers win outright; a few unparseable cells become INVALID rows later, not a different mapping.
  if (debit && credit) {
    mapping.debitColumn = debit;
    mapping.creditColumn = credit;
  } else {
    mapping.amountColumn = byHeader(AMOUNT_HEADERS) ?? columns.find((c) => c !== mapping.dateColumn && looksLikeAmount(c) && !DEBIT_HEADERS.test(c) && !CREDIT_HEADERS.test(c));
  }
  mapping.descriptionColumn =
    byHeader(DESC_HEADERS) ??
    columns.find((c) => c !== mapping.dateColumn && c !== mapping.amountColumn && c !== mapping.debitColumn && c !== mapping.creditColumn && sample.some((r) => (r[c] ?? "").length > 3 && safeToMinor(r[c]!) === null));

  let dateAmbiguous = false;
  if (mapping.dateColumn) {
    const inferred = inferDateFormat(sample.map((r) => r[mapping.dateColumn!] ?? ""));
    mapping.dateFormat = inferred ?? "MDY";
    dateAmbiguous = inferred === null;
  }
  // Card statements list charges as positive numbers: if every amount is positive and the
  // description column looks like merchants, positiveIsOut is the likelier convention; we still ask.
  mapping.signConvention = "negativeIsOut";
  return { mapping, evidence, dateAmbiguous };
}

/** Returns YMD/MDY/DMY when the sample settles it, null when ambiguous (every day ≤ 12). */
export function inferDateFormat(values: string[]): Exclude<Mapping["dateFormat"], "auto"> | null {
  const vals = values.filter((v) => v && v.trim());
  if (vals.length === 0) return null;
  if (vals.every((v) => /^\d{4}-\d{1,2}-\d{1,2}/.test(v.trim()))) return "YMD";
  if (vals.every((v) => /^\d{4}\/\d{1,2}\/\d{1,2}/.test(v.trim()))) return "YMD";
  const parts = vals.map((v) => v.trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)).filter((m): m is RegExpMatchArray => !!m);
  if (parts.length === 0) {
    // Textual months ("Sep 12, 2026", "12 Sep 2026") are unambiguous.
    return vals.every((v) => parseAnyDate(v, "auto") !== null) ? "MDY" : null;
  }
  const firstOver12 = parts.some((m) => Number(m[1]) > 12);
  const secondOver12 = parts.some((m) => Number(m[2]) > 12);
  if (firstOver12 && !secondOver12) return "DMY";
  if (secondOver12 && !firstOver12) return "MDY";
  return null;
}

const NUMERIC_FORMATS: Record<Exclude<Mapping["dateFormat"], "auto">, string[]> = {
  YMD: ["yyyy-MM-dd", "yyyy/MM/dd", "yyyy-M-d", "yyyy/M/d", "yyyyMMdd"],
  MDY: ["MM/dd/yyyy", "M/d/yyyy", "MM-dd-yyyy", "M-d-yyyy", "MM/dd/yy", "M/d/yy"],
  DMY: ["dd/MM/yyyy", "d/M/yyyy", "dd-MM-yyyy", "d-M-yyyy", "dd.MM.yyyy", "d.M.yyyy", "dd/MM/yy", "d/M/yy"],
};
const TEXT_FORMATS = ["MMM d, yyyy", "MMM d yyyy", "d MMM yyyy", "dd MMM yyyy", "MMMM d, yyyy", "d MMMM yyyy", "EEE, MMM d, yyyy"];

/** Parses a cell to a calendar date. `auto` tries ISO, then textual, then MDY. */
export function parseAnyDate(value: string, format: Mapping["dateFormat"]): CalendarDate | null {
  const v = value.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s?[AP]M)?$/i, ""); // drop a trailing time
  if (!v) return null;
  const candidates = format === "auto" ? [...NUMERIC_FORMATS.YMD, ...TEXT_FORMATS, ...NUMERIC_FORMATS.MDY] : [...NUMERIC_FORMATS[format], ...TEXT_FORMATS];
  for (const f of candidates) {
    const d = parseDate(v, f, new Date(2000, 0, 1));
    if (isValid(d) && d.getFullYear() >= 1970 && d.getFullYear() <= 2100) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }
  return null;
}

function safeToMinor(v: string, currency = "USD"): Minor | null {
  try {
    const cleaned = v.trim().replace(/\s/g, "");
    if (cleaned === "" || cleaned === "-") return null;
    const m = toMinor(cleaned, currency);
    return m;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Applying a mapping
// ---------------------------------------------------------------------------

export interface NormalizedRow {
  index: number;
  raw: Record<string, string>;
  date: CalendarDate | null;
  description: string | null;
  /** Signed: positive = money in. */
  amountMinor: Minor | null;
  problem: string | null;
}

export function applyMapping(rows: Record<string, string>[], mapping: Mapping, currency: string): NormalizedRow[] {
  const dateFormat = mapping.dateFormat === "auto" ? (inferDateFormat(rows.map((r) => r[mapping.dateColumn] ?? "")) ?? "MDY") : mapping.dateFormat;
  return rows.map((raw, index) => {
    const problems: string[] = [];
    const date = parseAnyDate(raw[mapping.dateColumn] ?? "", dateFormat);
    if (!date) problems.push(`no date in "${mapping.dateColumn}" (${JSON.stringify(raw[mapping.dateColumn] ?? "")})`);

    let amountMinor: Minor | null = null;
    if (mapping.amountColumn) {
      const cell = raw[mapping.amountColumn] ?? "";
      const m = safeToMinor(cell, currency);
      if (m === null) problems.push(`no amount in "${mapping.amountColumn}" (${JSON.stringify(cell)})`);
      else amountMinor = mapping.signConvention === "positiveIsOut" ? -m : m;
    } else {
      const debit = safeToMinor(raw[mapping.debitColumn!] ?? "", currency);
      const credit = safeToMinor(raw[mapping.creditColumn!] ?? "", currency);
      if (debit === null && credit === null) problems.push(`neither "${mapping.debitColumn}" nor "${mapping.creditColumn}" has an amount`);
      else amountMinor = Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
      if (debit !== null && credit !== null && debit !== 0 && credit !== 0) problems.push("both debit and credit are set");
    }
    if (amountMinor === 0) problems.push("amount is zero");

    const description = (raw[mapping.descriptionColumn] ?? "").trim() || null;
    if (!description) problems.push(`no description in "${mapping.descriptionColumn}"`);

    return { index, raw, date, description, amountMinor, problem: problems.length ? problems.join("; ") : null };
  });
}

/** Trim, collapse whitespace, case-fold, strip long digit runs (reference numbers drift between pending and posted). */
export function normalizeDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/\d{6,}/g, "#")
    .replace(/[^\p{L}\p{N}#\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Dedupe key. The occurrence index distinguishes two identical rows on the
 * same day within one file (two $5 coffees) while still matching the same
 * two rows in a re-uploaded file (eng review F6).
 */
export function dedupeHash(bankAccountId: string, date: CalendarDate, amountMinor: Minor, description: string, occurrence: number): string {
  return createHash("sha256").update([bankAccountId, date, String(amountMinor), normalizeDescription(description), String(occurrence)].join("|")).digest("hex").slice(0, 40);
}

/** Assigns occurrence indexes and hashes to normalized rows (only valid ones get a hash). */
export function withHashes(rows: NormalizedRow[], bankAccountId: string): (NormalizedRow & { hash: string | null })[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    if (r.problem || !r.date || r.amountMinor === null || !r.description) return { ...r, hash: null };
    const base = `${r.date}|${r.amountMinor}|${normalizeDescription(r.description)}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return { ...r, hash: dedupeHash(bankAccountId, r.date, r.amountMinor, r.description, occurrence) };
  });
}
