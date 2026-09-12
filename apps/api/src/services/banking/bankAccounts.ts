import { z } from "zod";
import type { Db } from "../../db/prisma.js";
import { AccountType, BankAccountKind } from "../../generated/prisma/enums.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";

/**
 * A bank account is a ledger account (asset, or liability for credit cards)
 * plus the metadata imports need. The Cash system account is the implicit
 * bank account for manual entries; the dashboard counts every account whose
 * systemKey is "cash" or starts with "bank:" as cash on hand.
 */
export const createBankAccountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.nativeEnum(BankAccountKind).default(BankAccountKind.CHECKING),
  mask: z.string().trim().max(8).optional(),
});

export interface BankAccountView {
  id: string;
  name: string;
  kind: BankAccountKind;
  accountId: string;
  currency: string;
  mask: string | null;
}

const toView = (b: { id: string; name: string; kind: BankAccountKind; accountId: string; currency: string; mask: string | null }): BankAccountView => ({ id: b.id, name: b.name, kind: b.kind, accountId: b.accountId, currency: b.currency, mask: b.mask });

export function bankAccountsService(db: Db) {
  return {
    async list(organizationId: string): Promise<BankAccountView[]> {
      return (await db.bankAccount.findMany({ where: { organizationId, isArchived: false }, orderBy: { createdAt: "asc" } })).map(toView);
    },

    async get(organizationId: string, id: string): Promise<BankAccountView> {
      const b = await db.bankAccount.findFirst({ where: { id, organizationId, isArchived: false } });
      if (!b) throw new NotFoundError("Bank account not found", "bank_account_not_found");
      return toView(b);
    },

    async create(organizationId: string, currency: string, input: z.infer<typeof createBankAccountSchema>, actorUserId: string | null): Promise<BankAccountView> {
      if (await db.bankAccount.findFirst({ where: { organizationId, name: input.name }, select: { id: true } })) {
        throw new ConflictError("A bank account with this name already exists", "bank_account_exists");
      }
      return db.$transaction(async (tx) => {
        const liability = input.kind === BankAccountKind.CREDIT_CARD;
        // Ledger account first (systemKey set after we know the bank account id).
        const account = await tx.account.create({ data: { organizationId, type: liability ? AccountType.LIABILITY : AccountType.ASSET, name: input.name } });
        const bank = await tx.bankAccount.create({ data: { organizationId, name: input.name, kind: input.kind, accountId: account.id, currency, mask: input.mask ?? null } });
        await tx.account.update({ where: { id: account.id }, data: { systemKey: `bank:${bank.id}` } });
        await tx.auditLog.create({ data: { organizationId, actorUserId, action: "bank_account.create", entityType: "BankAccount", entityId: bank.id, after: { name: bank.name, kind: bank.kind } } });
        return toView(bank);
      });
    },
  };
}
