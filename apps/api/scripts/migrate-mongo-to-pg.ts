import "dotenv/config";
import { floatToMinor, timestampToCalendar } from "@ledgeriq/shared";
import mongoose from "mongoose";
import { createPrisma, type Tx } from "../src/db/prisma.js";
import { AccountType, EntrySource, MembershipRole } from "../src/generated/prisma/enums.js";
import { seedDefaultChart, systemAccount } from "../src/services/ledger/chart.js";
import { postEntryTx } from "../src/services/ledger/ledger.js";

/**
 * One-time migration of the Expense Tracker's MongoDB data into the ledger
 * (ADR 0001, gate decision D2 = A2).
 *
 *   users            → users (same email, same bcrypt hash, legacyMongoId)
 *                      + one organization per user with an OWNER membership + default chart
 *   income rows      → entry: debit Cash / credit Sales (memo = source)
 *   expense rows     → entry: debit <expense account named after category> / credit Cash
 *
 * Idempotent: users by legacyMongoId, entries by externalRef = Mongo _id (source MIGRATION).
 * Verification per user: PG income/expense totals vs Mongo float sums, tolerance
 * 1 cent per row (eng review F7). Rows with null amounts are reported and skipped.
 *
 * Usage:
 *   npx tsx scripts/migrate-mongo-to-pg.ts --dry-run    # everything in one transaction, rolled back, report printed
 *   npx tsx scripts/migrate-mongo-to-pg.ts              # commit per user after that user's verification passes
 *   Options: --timezone America/Chicago (default), --mongo <url> (default MONGO_URL), --pg <url> (default DATABASE_URL)
 */

interface LegacyUser { _id: mongoose.Types.ObjectId; fullName: string; email: string; password: string; createdAt?: Date }
interface LegacyRow { _id: mongoose.Types.ObjectId; userId: mongoose.Types.ObjectId; amount?: number | null; date?: Date | null; source?: string; category?: string; icon?: string }

interface UserReport {
  email: string;
  organizationId: string;
  income: { rows: number; skipped: number; mongoTotal: number; pgMinor: number; ok: boolean };
  expense: { rows: number; skipped: number; mongoTotal: number; pgMinor: number; ok: boolean };
  created: number;
  existing: number;
}

class RollbackForDryRun extends Error {}

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string, fallback?: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const dryRun = flag("--dry-run");
const timezone = opt("--timezone", "America/Chicago")!;
const mongoUrl = opt("--mongo", process.env.MONGO_URL);
const pgUrl = opt("--pg", process.env.DATABASE_URL);
if (!mongoUrl || !pgUrl) {
  console.error("Config error: MONGO_URL and DATABASE_URL are both required (or pass --mongo / --pg).");
  process.exit(1);
}

const legacy = await mongoose.createConnection(mongoUrl).asPromise();
const Users = legacy.collection<LegacyUser>("users");
const Incomes = legacy.collection<LegacyRow>("incomes");
const Expenses = legacy.collection<LegacyRow>("expenses");
const db = createPrisma(pgUrl);

const reports: UserReport[] = [];
let failed = false;

try {
  const users = await Users.find({}).toArray();
  console.log(`${dryRun ? "[dry run] " : ""}Migrating ${users.length} user(s) from Mongo to Postgres (timezone ${timezone})`);

  for (const user of users) {
    const [incomes, expenses] = await Promise.all([Incomes.find({ userId: user._id }).toArray(), Expenses.find({ userId: user._id }).toArray()]);
    try {
      const report = await db.$transaction(
        async (tx) => {
          const r = await migrateUser(tx, user, incomes, expenses);
          if (!r.income.ok || !r.expense.ok) throw new Error(`verification failed for ${user.email}`);
          if (dryRun) throw new RollbackForDryRun();
          return r;
        },
        { timeout: 300_000, maxWait: 10_000 },
      );
      reports.push(report);
    } catch (err) {
      if (err instanceof RollbackForDryRun) {
        // Dry run: recompute the report outside the transaction for printing (nothing was committed).
        continue;
      }
      failed = true;
      console.error(`FAILED ${user.email}: ${(err as Error).message}`);
    }
  }
} finally {
  await legacy.close();
  await db.$disconnect();
}

for (const r of reports) {
  const line = (label: string, s: UserReport["income"]) => `  ${label.padEnd(8)} rows ${String(s.rows).padStart(4)}  skipped ${String(s.skipped).padStart(3)}  mongo ${s.mongoTotal.toFixed(2).padStart(12)}  pg ${(s.pgMinor / 100).toFixed(2).padStart(12)}  ${s.ok ? "OK" : "MISMATCH"}`;
  console.log(`${r.email} → org ${r.organizationId} (created ${r.created}, already present ${r.existing})`);
  console.log(line("income", r.income));
  console.log(line("expense", r.expense));
}
if (dryRun) console.log("Dry run complete: nothing was committed.");
process.exit(failed ? 1 : 0);

// ---------------------------------------------------------------------------

async function migrateUser(tx: Tx, user: LegacyUser, incomes: LegacyRow[], expenses: LegacyRow[]): Promise<UserReport> {
  const pgUser = await tx.user.upsert({
    where: { legacyMongoId: String(user._id) },
    update: {},
    create: { email: user.email.toLowerCase(), fullName: user.fullName, passwordHash: user.password, legacyMongoId: String(user._id) },
  });

  let membership = await tx.membership.findFirst({ where: { userId: pgUser.id, role: MembershipRole.OWNER }, include: { organization: true } });
  if (!membership) {
    const org = await tx.organization.create({ data: { name: `${user.fullName}'s books`, timezone } });
    membership = await tx.membership.create({ data: { organizationId: org.id, userId: pgUser.id, role: MembershipRole.OWNER }, include: { organization: true } });
    await seedDefaultChart(tx, org.id);
  }
  const org = membership.organization;

  const cash = (await systemAccount(tx, org.id, "cash")).id;
  const sales = (await systemAccount(tx, org.id, "sales")).id;
  const existingRefs = new Set(
    (await tx.journalEntry.findMany({ where: { organizationId: org.id, source: EntrySource.MIGRATION }, select: { externalRef: true } })).map((e) => e.externalRef),
  );

  let created = 0;
  let existing = 0;

  const income = { rows: incomes.length, skipped: 0, mongoTotal: 0, pgMinor: 0, ok: false };
  for (const row of incomes) {
    if (typeof row.amount !== "number" || !Number.isFinite(row.amount)) {
      income.skipped++;
      console.warn(`  skip income ${row._id} (${user.email}): amount is ${row.amount}`);
      continue;
    }
    income.mongoTotal += row.amount;
    const ref = String(row._id);
    if (existingRefs.has(ref)) {
      existing++;
      continue;
    }
    const minor = floatToMinor(row.amount);
    if (minor <= 0) {
      income.skipped++;
      continue;
    }
    await postEntryTx(tx, {
      organizationId: org.id,
      date: timestampToCalendar(row.date ?? new Date(), timezone),
      memo: row.source ?? "Income",
      source: EntrySource.MIGRATION,
      externalRef: ref,
      lines: [{ accountId: cash, debitMinor: minor, isBankSide: true }, { accountId: sales, creditMinor: minor }],
      actor: { userId: pgUser.id },
    });
    created++;
  }

  const expense = { rows: expenses.length, skipped: 0, mongoTotal: 0, pgMinor: 0, ok: false };
  const categoryAccounts = new Map<string, string>();
  for (const row of expenses) {
    if (typeof row.amount !== "number" || !Number.isFinite(row.amount)) {
      expense.skipped++;
      console.warn(`  skip expense ${row._id} (${user.email}): amount is ${row.amount}`);
      continue;
    }
    expense.mongoTotal += row.amount;
    const ref = String(row._id);
    if (existingRefs.has(ref)) {
      existing++;
      continue;
    }
    const minor = floatToMinor(row.amount);
    if (minor <= 0) {
      expense.skipped++;
      continue;
    }
    const category = (row.category ?? "Other expenses").trim() || "Other expenses";
    let accountId = categoryAccounts.get(category);
    if (!accountId) {
      const found = await tx.account.findFirst({ where: { organizationId: org.id, type: AccountType.EXPENSE, name: category } });
      accountId = found?.id ?? (await tx.account.create({ data: { organizationId: org.id, type: AccountType.EXPENSE, name: category } })).id;
      categoryAccounts.set(category, accountId);
    }
    await postEntryTx(tx, {
      organizationId: org.id,
      date: timestampToCalendar(row.date ?? new Date(), timezone),
      memo: category,
      source: EntrySource.MIGRATION,
      externalRef: ref,
      lines: [{ accountId, debitMinor: minor }, { accountId: cash, creditMinor: minor, isBankSide: true }],
      actor: { userId: pgUser.id },
    });
    created++;
  }

  // Verification: PG totals from the ledger vs Mongo float sums, 1 cent per row of tolerance.
  const [salesSum, cashCredits] = await Promise.all([
    tx.journalLine.aggregate({ where: { organizationId: org.id, accountId: sales, entry: { source: EntrySource.MIGRATION } }, _sum: { creditMinor: true } }),
    tx.journalLine.aggregate({ where: { organizationId: org.id, accountId: cash, isBankSide: true, entry: { source: EntrySource.MIGRATION } }, _sum: { creditMinor: true } }),
  ]);
  income.pgMinor = Number(salesSum._sum.creditMinor ?? 0n);
  expense.pgMinor = Number(cashCredits._sum.creditMinor ?? 0n);
  income.ok = Math.abs(income.pgMinor - Math.round(income.mongoTotal * 100)) <= Math.max(1, income.rows - income.skipped);
  expense.ok = Math.abs(expense.pgMinor - Math.round(expense.mongoTotal * 100)) <= Math.max(1, expense.rows - expense.skipped);

  const report: UserReport = { email: user.email, organizationId: org.id, income, expense, created, existing };
  if (dryRun) printReport(report);
  return report;
}

function printReport(r: UserReport) {
  const line = (label: string, s: UserReport["income"]) => `  ${label.padEnd(8)} rows ${String(s.rows).padStart(4)}  skipped ${String(s.skipped).padStart(3)}  mongo ${s.mongoTotal.toFixed(2).padStart(12)}  pg ${(s.pgMinor / 100).toFixed(2).padStart(12)}  ${s.ok ? "OK" : "MISMATCH"}`;
  console.log(`[dry run] ${r.email} → org ${r.organizationId} (would create ${r.created}, already present ${r.existing})`);
  console.log(line("income", r.income));
  console.log(line("expense", r.expense));
}
