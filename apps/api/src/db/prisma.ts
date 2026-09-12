import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../generated/prisma/client.js";

export type Db = PrismaClient;

/**
 * One PrismaClient per process, built on the pg driver adapter (Prisma 7).
 * Tests construct their own against TEST_DATABASE_URL (test/pg.ts).
 */
export function createPrisma(connectionString: string, opts: { log?: boolean } = {}): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter, log: opts.log ? ["query", "warn", "error"] : ["warn", "error"] });
}

/** A client inside an interactive transaction; services accept either. */
export type Tx = Prisma.TransactionClient;

const SERIALIZATION_FAILURE = "P2034";

/**
 * Runs `fn` in a SERIALIZABLE interactive transaction, retrying up to
 * `attempts` times with jitter when Postgres reports a serialization failure
 * (two writers touching the same entry/account rows). Ledger writes go
 * through here so the balance trigger and version checks see a consistent
 * snapshot (CEO review Section 2: P2034 → retry 3x, then surface).
 */
export async function serializable<T>(db: PrismaClient, fn: (tx: Tx) => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 20_000 });
    } catch (err) {
      lastError = err;
      const code = (err as { code?: string }).code;
      if (code !== SERIALIZATION_FAILURE || attempt === attempts) throw err;
      await new Promise((r) => setTimeout(r, 25 * attempt + Math.random() * 50));
    }
  }
  throw lastError;
}
