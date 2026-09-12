import { afterAll, beforeAll, beforeEach } from "vitest";
import { createPrisma, type Db } from "../src/db/prisma.js";
import { MembershipRole } from "../src/generated/prisma/enums.js";
import { seedDefaultChart, systemAccount } from "../src/services/ledger/chart.js";

/**
 * Postgres test harness. Requires TEST_DATABASE_URL (docs/setup.md#tests);
 * test/global-setup.ts runs `prisma migrate deploy` against it once per run.
 * Every test file truncates all tables before each test, so files are
 * independent as long as they run serially (vitest.config.ts: fileParallelism false).
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export function describePg(): boolean {
  return Boolean(TEST_DATABASE_URL);
}

let db: Db | undefined;

export function usePg(): () => Db {
  beforeAll(() => {
    if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
    db = createPrisma(TEST_DATABASE_URL);
  });
  beforeEach(async () => {
    await truncateAll(db!);
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  return () => db!;
}

export async function truncateAll(client: Db): Promise<void> {
  await client.$executeRawUnsafe(
    'TRUNCATE TABLE "audit_logs", "payouts", "journal_lines", "journal_entries", "sales_channels", "accounts", "memberships", "organizations", "users" RESTART IDENTITY CASCADE',
  );
}

export interface Fixture {
  orgId: string;
  userId: string;
  currency: string;
  timezone: string;
  account: (systemKey: string) => Promise<string>;
}

/** An organization with an owner and the default chart of accounts. */
export async function createOrgFixture(client: Db, opts: { name?: string; email?: string; timezone?: string } = {}): Promise<Fixture> {
  const user = await client.user.create({
    data: { email: opts.email ?? `owner-${Math.random().toString(36).slice(2, 8)}@example.com`, fullName: "Owner", passwordHash: "x" },
  });
  const org = await client.organization.create({
    data: {
      name: opts.name ?? "Fixture Co",
      timezone: opts.timezone ?? "America/Chicago",
      memberships: { create: { userId: user.id, role: MembershipRole.OWNER } },
    },
  });
  await client.$transaction((tx) => seedDefaultChart(tx, org.id));
  return {
    orgId: org.id,
    userId: user.id,
    currency: org.currency,
    timezone: org.timezone,
    account: async (systemKey) => (await client.$transaction((tx) => systemAccount(tx, org.id, systemKey))).id,
  };
}
