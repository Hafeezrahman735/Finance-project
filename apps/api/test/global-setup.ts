import "dotenv/config";
import { execSync } from "node:child_process";

/**
 * Once per test run: apply Prisma migrations to TEST_DATABASE_URL. Without it
 * every Postgres-backed suite skips itself with a warning (docs/setup.md#2-postgres).
 */
export default async function () {
  const pgUrl = process.env.TEST_DATABASE_URL;
  if (!pgUrl) {
    console.warn("[test] TEST_DATABASE_URL not set: all API suites will be skipped");
    return;
  }
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: pgUrl } });
}
