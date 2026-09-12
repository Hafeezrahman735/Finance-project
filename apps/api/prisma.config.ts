import "dotenv/config";
import { defineConfig } from "prisma/config";

// DATABASE_URL comes from apps/api/.env (dotenv) or the environment (CI, hosting).
// The test suite points Prisma at TEST_DATABASE_URL instead; see test/pg.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
