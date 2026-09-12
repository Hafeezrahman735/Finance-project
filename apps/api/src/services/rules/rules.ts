import { z } from "zod";
import { serializable, type Db, type Tx } from "../../db/prisma.js";
import { EntryStatus, RuleMatch } from "../../generated/prisma/enums.js";
import { NotFoundError, ValidationError } from "../../lib/errors.js";
import { normalizeDescription } from "../banking/csv.js";
import { CrossOrgReferenceError } from "../ledger/errors.js";
import { recategorizeEntryTx } from "../ledger/ledger.js";
import type { Actor } from "../ledger/types.js";

/**
 * "Always categorize X this way" (plan 1.4). Rules are matched against the
 * normalized description, first match wins by priority then age. Applied on
 * import; optionally applied to existing uncategorized rows when created.
 */

export const createRuleSchema = z.object({
  pattern: z.string().trim().min(2, "must be at least 2 characters").max(200),
  match: z.nativeEnum(RuleMatch).default(RuleMatch.CONTAINS),
  accountId: z.string().uuid(),
  channelId: z.string().uuid().nullable().optional(),
  priority: z.number().int().min(1).max(1000).default(100),
  /** Recategorize existing uncategorized transactions that match, right now. */
  applyToExisting: z.boolean().default(true),
});

export interface RuleView {
  id: string;
  pattern: string;
  match: RuleMatch;
  accountId: string;
  accountName: string;
  channelId: string | null;
  priority: number;
  hitCount: number;
  createdAt: string;
}

type RuleRow = { id: string; pattern: string; match: RuleMatch; accountId: string; channelId: string | null; priority: number };

/** Pure matcher shared by import and apply-to-existing. */
export function matchRule(description: string, rules: RuleRow[]): RuleRow | null {
  const normalized = normalizeDescription(description);
  for (const rule of rules) {
    const p = rule.pattern.toLowerCase().trim();
    if (rule.match === RuleMatch.EXACT && normalized === normalizeDescription(p)) return rule;
    if (rule.match === RuleMatch.CONTAINS && normalized.includes(normalizeDescription(p))) return rule;
    if (rule.match === RuleMatch.REGEX) {
      try {
        if (new RegExp(rule.pattern, "i").test(description)) return rule;
      } catch {
        // invalid pattern: skip
      }
    }
  }
  return null;
}

export function rulesService(db: Db) {
  const orderBy = [{ priority: "asc" as const }, { createdAt: "asc" as const }];

  return {
    async list(organizationId: string): Promise<RuleView[]> {
      const rows = await db.categoryRule.findMany({ where: { organizationId, isArchived: false }, orderBy, include: { account: { select: { name: true } } } });
      return rows.map((r) => ({ id: r.id, pattern: r.pattern, match: r.match, accountId: r.accountId, accountName: r.account.name, channelId: r.channelId, priority: r.priority, hitCount: r.hitCount, createdAt: r.createdAt.toISOString() }));
    },

    async activeRules(tx: Tx | Db, organizationId: string): Promise<RuleRow[]> {
      return tx.categoryRule.findMany({ where: { organizationId, isArchived: false }, orderBy, select: { id: true, pattern: true, match: true, accountId: true, channelId: true, priority: true } });
    },

    async create(organizationId: string, input: z.infer<typeof createRuleSchema>, actor: Actor): Promise<{ rule: RuleView; applied: number }> {
      if (input.match === RuleMatch.REGEX) {
        try {
          new RegExp(input.pattern, "i");
        } catch {
          throw new ValidationError("Not a valid regular expression", "pattern");
        }
      }
      return serializable(db, async (tx) => {
        const account = await tx.account.findFirst({ where: { id: input.accountId, organizationId, isArchived: false }, select: { id: true, name: true } });
        if (!account) throw new CrossOrgReferenceError("Account");
        if (input.channelId) {
          const ch = await tx.salesChannel.count({ where: { id: input.channelId, organizationId } });
          if (!ch) throw new CrossOrgReferenceError("Sales channel");
        }
        const rule = await tx.categoryRule.create({
          data: { organizationId, pattern: input.pattern, match: input.match, accountId: input.accountId, channelId: input.channelId ?? null, priority: input.priority, createdById: actor.userId ?? null },
        });
        await tx.auditLog.create({ data: { organizationId, actorUserId: actor.userId ?? null, requestId: actor.requestId ?? null, action: "rule.create", entityType: "CategoryRule", entityId: rule.id, after: { pattern: rule.pattern, match: rule.match, accountId: rule.accountId } } });

        let applied = 0;
        if (input.applyToExisting) {
          // Every unlocked, posted, uncategorized transaction whose description matches.
          const candidates = await tx.journalEntry.findMany({
            where: { organizationId, status: EntryStatus.POSTED, locked: false, reversesEntryId: null, lines: { some: { isBankSide: false, account: { systemKey: "uncategorized" } } } },
            select: { id: true, memo: true, version: true, lines: { where: { isBankSide: true }, select: { debitMinor: true, creditMinor: true } } },
          });
          for (const e of candidates) {
            if (!matchRule(e.memo, [rule])) continue;
            const bank = e.lines[0];
            if (!bank) continue;
            const amount = Number(bank.debitMinor > 0n ? bank.debitMinor : bank.creditMinor);
            await recategorizeEntryTx(tx, { organizationId, entryId: e.id, expectedVersion: e.version, offsets: [{ accountId: rule.accountId, amountMinor: amount, channelId: rule.channelId }], actor });
            applied++;
          }
          if (applied) await tx.categoryRule.update({ where: { id: rule.id }, data: { hitCount: { increment: applied } } });
        }
        return {
          rule: { id: rule.id, pattern: rule.pattern, match: rule.match, accountId: rule.accountId, accountName: account.name, channelId: rule.channelId, priority: rule.priority, hitCount: applied, createdAt: rule.createdAt.toISOString() },
          applied,
        };
      });
    },

    async remove(organizationId: string, id: string, actor: Actor): Promise<void> {
      const rule = await db.categoryRule.findFirst({ where: { id, organizationId, isArchived: false } });
      if (!rule) throw new NotFoundError("Rule not found", "rule_not_found");
      await db.categoryRule.update({ where: { id }, data: { isArchived: true } });
      await db.auditLog.create({ data: { organizationId, actorUserId: actor.userId ?? null, requestId: actor.requestId ?? null, action: "rule.archive", entityType: "CategoryRule", entityId: id, before: { pattern: rule.pattern } } });
    },
  };
}

export type RulesService = ReturnType<typeof rulesService>;
