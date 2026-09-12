import type { Tx } from "../../db/prisma.js";
import { AccountType } from "../../generated/prisma/enums.js";

/**
 * Default chart of accounts for a service business or product brand.
 * Small on purpose; users add accounts, and processors get clearing accounts
 * on demand via ensureClearingAccount(). systemKey is what services look up;
 * name and code are what accountants see.
 */
export interface DefaultAccount {
  systemKey: string;
  code: string;
  name: string;
  type: AccountType;
}

export const DEFAULT_CHART: readonly DefaultAccount[] = [
  // Assets
  { systemKey: "cash", code: "1000", name: "Cash", type: AccountType.ASSET },
  { systemKey: "accounts_receivable", code: "1200", name: "Accounts receivable", type: AccountType.ASSET },
  { systemKey: "undeposited_funds", code: "1300", name: "Undeposited funds", type: AccountType.ASSET },
  // Liabilities
  { systemKey: "accounts_payable", code: "2000", name: "Accounts payable", type: AccountType.LIABILITY },
  { systemKey: "sales_tax_payable", code: "2200", name: "Sales tax payable", type: AccountType.LIABILITY },
  { systemKey: "credit_card", code: "2100", name: "Credit card", type: AccountType.LIABILITY },
  // Equity
  { systemKey: "opening_balance", code: "3000", name: "Opening balance equity", type: AccountType.EQUITY },
  { systemKey: "owner_contributions", code: "3100", name: "Owner contributions", type: AccountType.EQUITY },
  { systemKey: "owner_draws", code: "3200", name: "Owner draws", type: AccountType.EQUITY },
  // Income
  { systemKey: "sales", code: "4000", name: "Sales", type: AccountType.INCOME },
  { systemKey: "other_income", code: "4900", name: "Other income", type: AccountType.INCOME },
  { systemKey: "refunds", code: "4100", name: "Refunds and returns", type: AccountType.INCOME },
  // Cost of sales
  { systemKey: "cogs", code: "5000", name: "Cost of goods sold", type: AccountType.EXPENSE },
  { systemKey: "processor_fees", code: "5100", name: "Payment processing fees", type: AccountType.EXPENSE },
  { systemKey: "shipping", code: "5200", name: "Shipping and fulfillment", type: AccountType.EXPENSE },
  // Operating expenses
  { systemKey: "advertising", code: "6000", name: "Advertising", type: AccountType.EXPENSE },
  { systemKey: "software", code: "6100", name: "Software and subscriptions", type: AccountType.EXPENSE },
  { systemKey: "contractors", code: "6200", name: "Contractors", type: AccountType.EXPENSE },
  { systemKey: "rent", code: "6300", name: "Rent", type: AccountType.EXPENSE },
  { systemKey: "utilities", code: "6400", name: "Utilities", type: AccountType.EXPENSE },
  { systemKey: "office", code: "6500", name: "Office and supplies", type: AccountType.EXPENSE },
  { systemKey: "travel", code: "6600", name: "Travel", type: AccountType.EXPENSE },
  { systemKey: "meals", code: "6700", name: "Meals", type: AccountType.EXPENSE },
  { systemKey: "professional_services", code: "6800", name: "Professional services", type: AccountType.EXPENSE },
  { systemKey: "bank_fees", code: "6900", name: "Bank fees", type: AccountType.EXPENSE },
  { systemKey: "processor_adjustments", code: "6950", name: "Processor adjustments", type: AccountType.EXPENSE },
  { systemKey: "other_expense", code: "6990", name: "Other expenses", type: AccountType.EXPENSE },
  // Holding account for imported rows until categorized (ADR 0004)
  { systemKey: "uncategorized", code: "9999", name: "Uncategorized", type: AccountType.EXPENSE },
];

export async function seedDefaultChart(tx: Tx, organizationId: string): Promise<void> {
  await tx.account.createMany({
    data: DEFAULT_CHART.map((a) => ({ organizationId, ...a })),
    skipDuplicates: true,
  });
}

/** Find a system account; throws if the org's chart is missing it (a seeding bug, not user error). */
export async function systemAccount(tx: Tx, organizationId: string, systemKey: string) {
  const account = await tx.account.findUnique({ where: { organizationId_systemKey: { organizationId, systemKey } } });
  if (!account) throw new Error(`Organization ${organizationId} has no system account "${systemKey}"`);
  return account;
}

/**
 * Per-processor clearing account ("clearing:stripe"). Deposits from a processor
 * land here, never in Sales; payout matching (Slice 2) moves gross, fees, and
 * refunds behind them (ADR 0004).
 */
export async function ensureClearingAccount(tx: Tx, organizationId: string, processor: string, displayName: string) {
  const systemKey = `clearing:${processor}`;
  return tx.account.upsert({
    where: { organizationId_systemKey: { organizationId, systemKey } },
    update: {},
    create: { organizationId, systemKey, name: `${displayName} clearing`, type: AccountType.ASSET },
  });
}
