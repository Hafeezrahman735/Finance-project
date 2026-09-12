import "dotenv/config";
import { execSync } from "node:child_process";
import { MongoMemoryServer } from "mongodb-memory-server";

/**
 * Once per test run:
 *  - start one in-memory mongod (the legacy API tests; each file picks its own db name)
 *  - apply Prisma migrations to TEST_DATABASE_URL (the ledger tests), if it is set
 *
 * Without TEST_DATABASE_URL the Postgres-backed suites skip themselves with a
 * clear message instead of failing (docs/setup.md#tests).
 */
export default async function () {
  const mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 120_000 } });
  process.env.TEST_MONGO_URI = mongod.getUri();

  const pgUrl = process.env.TEST_DATABASE_URL;
  if (pgUrl) {
    execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: pgUrl } });
  } else {
    console.warn("[test] TEST_DATABASE_URL not set: Postgres ledger suites will be skipped");
  }

  return async () => {
    await mongod.stop();
  };
}
