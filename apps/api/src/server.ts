import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPrisma } from "./db/prisma.js";
import { createLogger } from "./lib/logger.js";

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development");

const db = createPrisma(config.DATABASE_URL);
try {
  await db.$queryRaw`SELECT 1`;
  logger.info("Postgres connected");
} catch (err) {
  logger.error({ err }, "Could not connect to Postgres. Check DATABASE_URL and that the server is running (docs/setup.md#troubleshooting).");
  process.exit(1);
}

const app = createApp(db, config, logger);
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, `server running on port ${config.PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    server.close(() => {
      void db.$disconnect().finally(() => process.exit(0));
    });
  });
}
