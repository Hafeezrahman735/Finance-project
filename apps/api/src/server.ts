import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { connectDB } from "./db.js";
import { createLogger } from "./lib/logger.js";

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development");

try {
  await connectDB(config.MONGO_URL);
  logger.info("MongoDB connected");
} catch (err) {
  logger.error({ err }, "Could not connect to MongoDB. Check MONGO_URL and the Atlas IP allowlist (docs/setup.md#troubleshooting).");
  process.exit(1);
}

const app = createApp(config, logger);
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, `server running on port ${config.PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    server.close(() => process.exit(0));
  });
}
