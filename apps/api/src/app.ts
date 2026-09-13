import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import type { Logger } from "pino";
import type { Config } from "./config.js";
import type { Db } from "./db/prisma.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";
import { requestLogger } from "./lib/logger.js";
import { buildRouter, type RouteDeps } from "./routes.js";
import { createEmailSink } from "./services/email/email.js";
import { createBriefModel } from "./services/ai/model.js";
import { createFeedProvider } from "./services/banking/feedProvider.js";
import { createSecrets } from "./lib/secrets.js";

/**
 * Request flow:
 *
 *   request ─▶ requestLogger (id, child log) ─▶ cors ─▶ express.json
 *           ─▶ cookieParser (refresh cookie on /api/v1/auth/*)
 *           ─▶ /healthz | /api/v1/* (routes.ts: validate ─▶ protect ─▶ controller)
 *           ─▶ notFoundHandler (unmatched)
 *           ─▶ errorHandler (AppError | ZodError | parse error | unknown → envelope)
 *
 * Built as a factory so tests can spin up an app against the test Postgres
 * with their own config, without touching process.env or listening on a port.
 */
export function createApp(db: Db, config: Config, logger: Logger, deps: Partial<RouteDeps> = {}): Express {
  const app = express();
  app.disable("x-powered-by");
  // Only trust X-Forwarded-For when told to (TRUST_PROXY); trusting it blindly lets a direct client spoof its IP past the rate limits.
  if (config.TRUST_PROXY) app.set("trust proxy", /^\d+$/.test(config.TRUST_PROXY) ? Number(config.TRUST_PROXY) : config.TRUST_PROXY === "true" ? true : config.TRUST_PROXY);

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
  app.use(cookieParser());

  app.get("/healthz", async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  });
  const warn = (msg: string) => logger.warn(msg);
  app.use(
    "/api/v1",
    buildRouter(db, config, {
      email: deps.email ?? createEmailSink(config, logger),
      briefModel: deps.briefModel ?? createBriefModel(config, logger),
      feedProvider: deps.feedProvider ?? createFeedProvider(config, warn),
      secrets: deps.secrets ?? createSecrets(config, warn),
      logger,
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
