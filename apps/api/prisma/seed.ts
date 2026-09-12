import "dotenv/config";
import { createPrisma } from "../src/db/prisma.js";
import { DEMO_EMAIL, DEMO_PASSWORD, seedDemoOrg } from "../src/fixtures/demoOrg.js";

// `npm run db:seed` (root) / `prisma db seed` (apps/api): creates or rebuilds the
// demo organization so a fresh clone has something to click through.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Config error: DATABASE_URL is missing. Copy apps/api/.env.example to apps/api/.env and set it (docs/setup.md#3-configure-the-api).");
  process.exit(1);
}
const db = createPrisma(url);
try {
  const summary = await seedDemoOrg(db);
  console.log(`Seeded demo organization ${summary.organizationId}: ${summary.entries} entries (${summary.uncategorized} uncategorized) from ${summary.from} to ${summary.to}.`);
  console.log(`Log in with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
} finally {
  await db.$disconnect();
}
