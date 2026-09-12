import cors from "cors";
import express, { type Express } from "express";
import type { Logger } from "pino";
import type { Config } from "./config.js";
import type { Db } from "./db/prisma.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";
import { requestLogger } from "./lib/logger.js";
import { buildRouter } from "./routes.js";

/**
 * Request flow:
 *
 *   request ─▶ requestLogger (id, child log) ─▶ cors ─▶ express.json
 *           ─▶ /healthz | /api/v1/* (routes.ts: validate ─▶ protect ─▶ controller)
 *           ─▶ notFoundHandler (unmatched)
 *           ─▶ errorHandler (AppError | ZodError | parse error | unknown → envelope)
 *
 * Built as a factory so tests can spin up an app against the test Postgres
 * with their own config, without touching process.env or listening on a port.
 */
export function createApp(db: Db, config: Config, logger: Logger): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(requestLogger(logger));
  app.use(
    cors({
      // With the Vite proxy the web app is same-origin and CORS never triggers.
      // CLIENT_URL is only for a separately hosted web app; never "*" in production.
      origin: config.CLIENT_URL ?? (config.NODE_ENV === "production" ? false : true),
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id", "Content-Disposition"],
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  });
  app.use("/api/v1", buildRouter(db, config));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
