import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import pino, { type Logger } from "pino";

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    // Never log credentials or raw money-row descriptions (CEO review, Section 3).
    redact: { paths: ["req.headers.authorization", "password", "*.password", "token", "*.token"], censor: "[redacted]" },
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } } } : {}),
  });
}

declare module "express-serve-static-core" {
  interface Request {
    id: string;
    log: Logger;
  }
}

/**
 * Attaches a request id (honouring an incoming X-Request-Id) and a child
 * logger to every request, echoes the id on the response, and logs one line
 * per request on finish. Error responses carry the same id (lib/errors.ts) so
 * a user-reported id maps to exactly one log line.
 */
export function requestLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = req.get("x-request-id") ?? randomUUID();
    req.id = id;
    req.log = logger.child({ requestId: id });
    res.setHeader("x-request-id", id);
    const started = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const userId = (req as Request & { user?: { id?: string } }).user?.id;
      req.log.info({ method: req.method, route: req.originalUrl, status: res.statusCode, durationMs: Math.round(durationMs), userId }, "request");
    });
    next();
  };
}
