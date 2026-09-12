import { calendarToDateColumn, dateColumnToCalendar, type CalendarDate } from "@ledgeriq/shared";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";
import { serializable, type Db } from "../../db/prisma.js";
import { EntrySource, ImportRowStatus, ImportStatus } from "../../generated/prisma/enums.js";
import { ConflictError, NotFoundError, ValidationError } from "../../lib/errors.js";
import { systemAccount } from "../ledger/chart.js";
import { postEntryTx } from "../ledger/ledger.js";
import type { Actor } from "../ledger/types.js";
import { matchRule, rulesService } from "../rules/rules.js";
import { bankAccountsService } from "./bankAccounts.js";
import { applyMapping, CsvError, guessMapping, mappingSchema, parseCsv, withHashes, type Mapping, type MappingGuess } from "./csv.js";

/**
 * Import lifecycle (design spec §3, eng review F6/F16):
 *
 *   upload  ──▶ UPLOADED  (rows stored raw, mapping guessed)
 *   mapping ──▶ MAPPED    (rows normalized: NEW | DUPLICATE | INVALID, counts on the import)
 *   commit  ──▶ COMMITTING ──▶ COMMITTED     (batches of 500, each its own transaction;
 *                          └─▶ FAILED        a crash leaves IMPORTED rows in place and commit() resumes)
 *
 * Every entry an import creates carries externalRef = "csv:<dedupeHash>" under
 * source BANK, so the database refuses a second import of the same row even
 * if two commits race.
 */

export const BATCH_SIZE = 500;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const commitSchema = z.object({
  /** Row indexes the user chose to import even though they look like duplicates ("un-skip"). */
  includeDuplicates: z.array(z.number().int().min(0)).default([]),
});

export interface ImportView {
  id: string;
  bankAccountId: string;
  filename: string;
  status: ImportStatus;
  columns: string[];
  mapping: Mapping | null;
  rowCount: number;
  newCount: number;
  duplicateCount: number;
  invalidCount: number;
  importedCount: number;
  error: string | null;
  createdAt: string;
}

export interface RowView {
  index: number;
  date: CalendarDate | null;
  description: string | null;
  amountMinor: number | null;
  status: ImportRowStatus;
  problem: string | null;
  raw: Record<string, string>;
}

type ImportRow = Prisma.ImportGetPayload<object>;

function toView(i: ImportRow): ImportView {
  return {
    id: i.id,
    bankAccountId: i.bankAccountId,
    filename: i.filename,
    status: i.status,
    columns: i.columns as string[],
    mapping: (i.mapping as Mapping | null) ?? null,
    rowCount: i.rowCount,
    newCount: i.newCount,
    duplicateCount: i.duplicateCount,
    invalidCount: i.invalidCount,
    importedCount: i.importedCount,
    error: i.error,
    createdAt: i.createdAt.toISOString(),
  };
}

export function importsService(db: Db) {
  const rules = rulesService(db);
  const bankAccounts = bankAccountsService(db);

  async function load(organizationId: string, id: string) {
    const row = await db.import.findFirst({ where: { id, organizationId } });
    if (!row) throw new NotFoundError("Import not found", "import_not_found");
    return row;
  }

  return {
    /** Step 1: parse the file, store raw rows, guess the mapping. */
    async upload(organizationId: string, bankAccountId: string, filename: string, bytes: Buffer, actor: Actor): Promise<{ import: ImportView; guess: MappingGuess; sample: Record<string, string>[] }> {
      if (bytes.length > MAX_FILE_BYTES) throw new ValidationError("File is larger than 10 MB; split it and import in parts", "file");
      await bankAccounts.get(organizationId, bankAccountId);
      let parsed;
      try {
        parsed = parseCsv(bytes);
      } catch (err) {
        if (err instanceof CsvError) throw new ValidationError(err.message, "file");
        throw new ValidationError("This file could not be read as CSV. Export a CSV from your bank and try again.", "file");
      }
      if (parsed.columns.length < 2) throw new ValidationError(`This doesn't look like a statement (found ${parsed.columns.length} column). Export CSV from your bank and try again.`, "file");
      if (parsed.rows.length === 0) throw new ValidationError("The file has a header but no rows.", "file");

      const guess = guessMapping(parsed.columns, parsed.rows);
      const created = await db.$transaction(async (tx) => {
        const imp = await tx.import.create({
          data: { organizationId, bankAccountId, filename: filename.slice(0, 200), columns: parsed.columns, rowCount: parsed.rows.length, createdById: actor.userId ?? null },
        });
        // Raw rows in chunks; normalization happens once the mapping is confirmed.
        for (let i = 0; i < parsed.rows.length; i += 1000) {
          await tx.importRow.createMany({ data: parsed.rows.slice(i, i + 1000).map((raw, j) => ({ importId: imp.id, organizationId, index: i + j, raw })) });
        }
        return imp;
      }, { timeout: 120_000, maxWait: 10_000 });
      return { import: toView(created), guess, sample: parsed.rows.slice(0, 5) };
    },

    /** Step 2: confirm the four questions; normalize and dedupe every row. Re-runnable until commit. */
    async setMapping(organizationId: string, id: string, input: unknown): Promise<{ import: ImportView; preview: { newRows: RowView[]; duplicateRows: RowView[]; invalidRows: RowView[] } }> {
      const mapping = mappingSchema.parse(input);
      const imp = await load(organizationId, id);
      if (imp.status === ImportStatus.COMMITTED || imp.status === ImportStatus.COMMITTING) throw new ConflictError("This import was already committed", "import_committed");
      const columns = imp.columns as string[];
      for (const c of [mapping.dateColumn, mapping.descriptionColumn, mapping.amountColumn, mapping.debitColumn, mapping.creditColumn]) {
        if (c && !columns.includes(c)) throw new ValidationError(`"${c}" is not a column in this file`, "mapping");
      }
      const bank = await bankAccounts.get(organizationId, imp.bankAccountId);
      const rawRows = await db.importRow.findMany({ where: { importId: imp.id }, orderBy: { index: "asc" }, select: { index: true, raw: true } });
      const normalized = withHashes(applyMapping(rawRows.map((r) => r.raw as Record<string, string>), mapping, bank.currency), bank.id);

      // Duplicates: hash already imported by a previous import of this organization (externalRef "csv:<hash>").
      const hashes = normalized.map((r) => r.hash).filter((h): h is string => !!h);
      const existing = new Set(
        (await db.journalEntry.findMany({ where: { organizationId, source: EntrySource.BANK, externalRef: { in: hashes.map((h) => `csv:${h}`) } }, select: { externalRef: true } })).map((e) => e.externalRef!.slice(4)),
      );

      let newCount = 0;
      let duplicateCount = 0;
      let invalidCount = 0;
      await db.$transaction(async (tx) => {
        for (const r of normalized) {
          let status: ImportRowStatus;
          if (r.problem || !r.hash) {
            status = ImportRowStatus.INVALID;
            invalidCount++;
          } else if (existing.has(r.hash)) {
            status = ImportRowStatus.DUPLICATE;
            duplicateCount++;
          } else {
            status = ImportRowStatus.NEW;
            newCount++;
          }
          await tx.importRow.update({
            where: { importId_index: { importId: imp.id, index: r.index } },
            data: { date: r.date ? calendarToDateColumn(r.date) : null, description: r.description, amountMinor: r.amountMinor === null ? null : BigInt(r.amountMinor), dedupeHash: r.hash, status, problem: r.problem, entryId: null },
          });
        }
        await tx.import.update({ where: { id: imp.id }, data: { mapping, status: ImportStatus.MAPPED, newCount, duplicateCount, invalidCount, importedCount: 0, error: null } });
      }, { timeout: 300_000, maxWait: 10_000 });

      const updated = await load(organizationId, id);
      return { import: toView(updated), preview: await this.preview(organizationId, id) };
    },

    async preview(organizationId: string, id: string) {
      const imp = await load(organizationId, id);
      const rows = await db.importRow.findMany({ where: { importId: imp.id }, orderBy: { index: "asc" } });
      const view = (r: (typeof rows)[number]): RowView => ({ index: r.index, date: r.date ? dateColumnToCalendar(r.date) : null, description: r.description, amountMinor: r.amountMinor === null ? null : Number(r.amountMinor), status: r.status, problem: r.problem, raw: r.raw as Record<string, string> });
      return {
        newRows: rows.filter((r) => r.status === ImportRowStatus.NEW || r.status === ImportRowStatus.IMPORTED).slice(0, 20).map(view),
        duplicateRows: rows.filter((r) => r.status === ImportRowStatus.DUPLICATE).map(view),
        invalidRows: rows.filter((r) => r.status === ImportRowStatus.INVALID).map(view),
      };
    },

    /**
     * Step 3: post entries in batches of 500, each batch its own transaction.
     * Safe to call again after a failure: IMPORTED rows are skipped, the rest resume.
     */
    async commit(organizationId: string, id: string, input: unknown, actor: Actor): Promise<ImportView> {
      const { includeDuplicates } = commitSchema.parse(input);
      const imp = await load(organizationId, id);
      if (imp.status === ImportStatus.UPLOADED) throw new ConflictError("Confirm the column mapping before importing", "import_not_mapped");
      if (imp.status === ImportStatus.COMMITTED) return toView(imp);
      const mapping = imp.mapping as Mapping;
      if (!mapping) throw new ConflictError("Confirm the column mapping before importing", "import_not_mapped");
      const bank = await bankAccounts.get(organizationId, imp.bankAccountId);

      if (includeDuplicates.length) {
        await db.importRow.updateMany({ where: { importId: imp.id, index: { in: includeDuplicates }, status: ImportRowStatus.DUPLICATE }, data: { status: ImportRowStatus.NEW } });
      }
      await db.import.update({ where: { id: imp.id }, data: { status: ImportStatus.COMMITTING, error: null } });

      const activeRules = await rules.activeRules(db, organizationId);
      const ruleHits = new Map<string, number>();
      try {
        for (;;) {
          const batch = await db.importRow.findMany({ where: { importId: imp.id, status: ImportRowStatus.NEW }, orderBy: { index: "asc" }, take: BATCH_SIZE });
          if (batch.length === 0) break;
          await serializable(db, async (tx) => {
            const uncategorized = await systemAccount(tx, organizationId, "uncategorized");
            for (const row of batch) {
              const amount = Number(row.amountMinor!);
              const description = row.description!;
              const rule = matchRule(description, activeRules);
              const offsetAccount = rule?.accountId ?? uncategorized.id;
              const abs = Math.abs(amount);
              const lines = amount > 0
                ? [{ accountId: bank.accountId, debitMinor: abs, isBankSide: true }, { accountId: offsetAccount, creditMinor: abs, channelId: rule?.channelId ?? null }]
                : [{ accountId: bank.accountId, creditMinor: abs, isBankSide: true }, { accountId: offsetAccount, debitMinor: abs, channelId: rule?.channelId ?? null }];
              const entry = await postEntryTx(tx, {
                organizationId,
                date: dateColumnToCalendar(row.date!),
                memo: description,
                source: EntrySource.BANK,
                externalRef: `csv:${row.dedupeHash}`,
                lines,
                actor,
              });
              await tx.importRow.update({ where: { id: row.id }, data: { status: ImportRowStatus.IMPORTED, entryId: entry.id } });
              if (rule) ruleHits.set(rule.id, (ruleHits.get(rule.id) ?? 0) + 1);
            }
            await tx.import.update({ where: { id: imp.id }, data: { importedCount: { increment: batch.length } } });
          });
        }
        for (const [ruleId, hits] of ruleHits) await db.categoryRule.update({ where: { id: ruleId }, data: { hitCount: { increment: hits } } });
        const done = await db.import.update({ where: { id: imp.id }, data: { status: ImportStatus.COMMITTED } });
        await db.auditLog.create({ data: { organizationId, actorUserId: actor.userId ?? null, requestId: actor.requestId ?? null, action: "import.commit", entityType: "Import", entityId: imp.id, after: { imported: done.importedCount, duplicates: done.duplicateCount, invalid: done.invalidCount } } });
        return toView(done);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const failed = await db.import.update({ where: { id: imp.id }, data: { status: ImportStatus.FAILED, error: message.slice(0, 500) } });
        void failed;
        throw err;
      }
    },

    async get(organizationId: string, id: string): Promise<ImportView> {
      return toView(await load(organizationId, id));
    },

    async list(organizationId: string): Promise<ImportView[]> {
      return (await db.import.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50 })).map(toView);
    },
  };
}

export type ImportsService = ReturnType<typeof importsService>;
