import type { Request, RequestHandler } from "express";
import { rateLimit, type Options } from "express-rate-limit";
import { RateLimitError } from "../lib/errors.js";

/**
 * Auth rate limits (plan 1.1; pre-tester prerequisite). In-memory counters
 * per API process, which is right for one instance; move the store to
 * Postgres/Redis when there are several. Keys combine the client IP with the
 * email in the body where there is one, so one attacker cannot lock out
 * everyone behind a NAT and one victim cannot be hammered from many IPs
 * beyond the per-email budget.
 *
 * Behind a reverse proxy set `app.set("trust proxy", 1)` so `req.ip` is the
 * client, not the proxy (docs/setup.md).
 */
export interface AuthLimits {
  enabled: boolean;
}

const emailOf = (req: Request): string => {
  const e = (req.body as { email?: unknown } | undefined)?.email;
  return typeof e === "string" ? e.trim().toLowerCase() : "";
};

function limiter(name: string, windowMs: number, limit: number, keyGenerator: (req: Request) => string): RequestHandler {
  const opts: Partial<Options> = {
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => `${name}:${keyGenerator(req as Request)}`,
    // Emit the API's error envelope instead of the library's default text body.
    handler: (_req, _res, next) => next(new RateLimitError("Too many attempts; try again in a few minutes", `rate_limited_${name}`)),
    validate: { xForwardedForHeader: false, default: true },
  };
  return rateLimit(opts);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** One limiter per auth route, keyed by route name; a no-op when disabled (tests). */
export function authRateLimits(cfg: AuthLimits): Record<string, RequestHandler> {
  if (!cfg.enabled) return {};
  const ipAndEmail = (req: Request) => `${req.ip}|${emailOf(req)}`;
  const ip = (req: Request) => req.ip ?? "";
  const user = (req: Request) => req.user?.id ?? req.ip ?? "";
  return {
    login: limiter("login", 15 * MINUTE, 10, ipAndEmail),
    register: limiter("register", HOUR, 5, ip),
    refresh: limiter("refresh", 15 * MINUTE, 60, ip),
    forgot_password: limiter("forgot_password", HOUR, 5, ipAndEmail),
    reset_password: limiter("reset_password", HOUR, 10, ip),
    verify_email: limiter("verify_email", HOUR, 20, ip),
    resend_verification: limiter("resend_verification", HOUR, 3, user),
  };
}
