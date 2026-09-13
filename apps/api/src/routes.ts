import { Router, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import type { Config } from "./config.js";
import type { Db } from "./db/prisma.js";
import { MembershipRole } from "./generated/prisma/enums.js";
import type { Prisma } from "./generated/prisma/client.js";
import { NotFoundError, ValidationError as ValidationErrorForRoute } from "./lib/errors.js";
import { sendWorkbook } from "./lib/excel.js";
import { protect, requireOrg } from "./middleware/auth.js";
import { authRateLimits } from "./middleware/rateLimit.js";
import { body, validateBody } from "./middleware/validate.js";
import type { Logger } from "pino";
import { authService, forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema, toUserDTO, verifyEmailSchema, type AuthResult } from "./services/auth/auth.js";
import type { EmailSink } from "./services/email/email.js";
import { bankAccountsService, createBankAccountSchema } from "./services/banking/bankAccounts.js";
import { importsService, MAX_FILE_BYTES } from "./services/banking/imports.js";
import { connectSchema, feedsService } from "./services/banking/feeds.js";
import type { FeedProvider } from "./services/banking/feedProvider.js";
import type { Secrets } from "./lib/secrets.js";
import { createRuleSchema, rulesService } from "./services/rules/rules.js";
import { dashboardService } from "./services/dashboard/dashboard.js";
import { metricsService } from "./services/metrics/metrics.js";
import { briefService, type BriefOrg } from "./services/ai/brief.js";
import type { BriefModel } from "./services/ai/model.js";
import { createSchema, listQuerySchema, transactionsService, updateSchema } from "./services/transactions/transactions.js";

/**
 * Route table for /api/v1 (docs/architecture.md conventions: plural nouns,
 * actions as sub-resources, camelCase JSON, {data, nextCursor} lists).
 *
 * `access` is what the generated authz matrix (test/authz.test.ts) checks:
 *   public            no token needed
 *   auth              any signed-in user
 *   <MembershipRole>  signed-in member of the active organization with at least this role
 *
 * Adding a route here is what puts it under test; a route that is not in this
 * table does not exist.
 */
export type Access = "public" | "auth" | MembershipRole;

export interface RouteDef {
  method: "get" | "post" | "patch" | "delete";
  path: string;
  access: Access;
  /** Example path params for the authz matrix (a syntactically valid but foreign id). */
  example?: string;
  handler: RequestHandler;
}

const actor = (req: Request) => ({ userId: req.user?.id ?? null, requestId: req.id });

/** Per-organization feature flags an owner can change. */
const featuresSchema = z.object({ moneyBrief: z.boolean() });

export interface RouteDeps {
  email: EmailSink;
  /** The brief's model seam (anthropic | recorded | off). */
  briefModel: BriefModel;
  /** Bank feeds (plaid | fixture) and the key ring for access tokens at rest. */
  feedProvider: FeedProvider;
  secrets: Secrets;
  logger?: Logger;
}

export const REFRESH_COOKIE = "ledgeriq_refresh";

export function routeTable(db: Db, config: Config, deps: RouteDeps): RouteDef[] {
  const auth = authService(db, config, deps.email, deps.logger);
  const cookieOpts = (maxAgeMs: number) => ({ httpOnly: true, sameSite: "strict" as const, secure: config.NODE_ENV === "production", path: "/api/v1/auth", maxAge: maxAgeMs });
  const setRefresh = (res: Response, raw: string) => res.cookie(REFRESH_COOKIE, raw, cookieOpts(config.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000));
  const clearRefresh = (res: Response) => res.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
  const readRefresh = (req: Request) => (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  const withoutRefresh = ({ refreshToken: _r, ...rest }: AuthResult) => rest;
  const limits = authRateLimits({ enabled: config.AUTH_RATE_LIMIT });
  /** Rate-limit an auth handler by route name (no-op when limits are disabled). */
  const limited = (name: string, handler: RequestHandler): RequestHandler => (limits[name] ? chain(limits[name], (req, res) => new Promise<void>((resolve, reject) => handler(req, res, (err?: unknown) => (err ? reject(err) : resolve())))) : handler);
  const txns = transactionsService(db);
  const dashboard = dashboardService(db);
  const metrics = metricsService(db);
  const briefs = briefService(db, { metrics, model: deps.briefModel, email: deps.email, appUrl: config.APP_URL, logger: deps.logger });
  /** The org context plus its feature flags (the brief is flag-gated per org). */
  const briefOrg = async (req: Request): Promise<BriefOrg> => {
    const row = await db.organization.findUnique({ where: { id: req.org!.id }, select: { featureFlags: true } });
    return { ...req.org!, featureFlags: row?.featureFlags };
  };
  const banks = bankAccountsService(db);
  const feeds = feedsService(db, { provider: deps.feedProvider, secrets: deps.secrets, logger: deps.logger });
  const imports = importsService(db);
  const rules = rulesService(db);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1 } });
  const FOREIGN = "00000000-0000-4000-8000-000000000000";

  const orgDTO = (req: Request) => ({ id: req.org!.id, name: req.org!.name, currency: req.org!.currency, timezone: req.org!.timezone, role: req.org!.role });

  return [
    // --- auth -------------------------------------------------------------
    {
      method: "post",
      path: "/auth/register",
      access: "public",
      handler: limited("register", chain(validateBody(registerSchema), async (req, res) => {
        const r = await auth.register(body<typeof registerSchema>(req), req.get("user-agent"));
        setRefresh(res, r.refreshToken);
        res.status(201).json(withoutRefresh(r));
      })),
    },
    {
      method: "post",
      path: "/auth/login",
      access: "public",
      handler: limited("login", chain(validateBody(loginSchema), async (req, res) => {
        const r = await auth.login(body<typeof loginSchema>(req), req.get("user-agent"));
        setRefresh(res, r.refreshToken);
        res.json(withoutRefresh(r));
      })),
    },
    {
      method: "post",
      path: "/auth/refresh",
      access: "public",
      handler: limited("refresh", async (req, res, next) => {
        try {
          const r = await auth.refresh(readRefresh(req), req.get("user-agent"));
          setRefresh(res, r.refreshToken);
          res.json({ token: r.token, user: r.user });
        } catch (err) {
          clearRefresh(res);
          next(err);
        }
      }),
    },
    {
      method: "post",
      path: "/auth/logout",
      access: "public",
      handler: async (req, res) => {
        await auth.sessions.revoke(readRefresh(req));
        clearRefresh(res);
        res.json({ message: "Signed out" });
      },
    },
    {
      method: "post",
      path: "/auth/logout-all",
      access: "auth",
      handler: async (req, res) => {
        const count = await auth.sessions.revokeAll(req.user!.id);
        clearRefresh(res);
        res.json({ message: "Signed out everywhere", sessions: count });
      },
    },
    {
      method: "post",
      path: "/auth/forgot-password",
      access: "public",
      handler: limited("forgot_password", chain(validateBody(forgotPasswordSchema), async (req, res) => {
        await auth.forgotPassword(body<typeof forgotPasswordSchema>(req));
        res.json({ message: "If that email has an account, a reset link is on its way" });
      })),
    },
    {
      method: "post",
      path: "/auth/reset-password",
      access: "public",
      handler: limited("reset_password", chain(validateBody(resetPasswordSchema), async (req, res) => {
        await auth.resetPassword(body<typeof resetPasswordSchema>(req));
        res.json({ message: "Password updated; log in with the new one" });
      })),
    },
    { method: "post", path: "/auth/verify-email", access: "public", handler: limited("verify_email", chain(validateBody(verifyEmailSchema), async (req, res) => res.json({ user: await auth.verifyEmail(body<typeof verifyEmailSchema>(req)) }))) },
    {
      method: "post",
      path: "/auth/resend-verification",
      access: "auth",
      handler: limited("resend_verification", async (req, res, next) => {
        try {
          await auth.resendVerification(req.user!.id);
          res.json({ message: "Verification email sent" });
        } catch (err) {
          next(err);
        }
      }),
    },
    { method: "get", path: "/auth/me", access: "auth", handler: async (req, res) => res.json({ user: toUserDTO(req.user!), organization: await auth.primaryOrganization(req.user!.id) }) },

    // --- organizations ----------------------------------------------------
    {
      method: "get",
      path: "/organizations",
      access: "auth",
      handler: async (req, res) => {
        const memberships = await db.membership.findMany({ where: { userId: req.user!.id }, include: { organization: true }, orderBy: { createdAt: "asc" } });
        res.json({ data: memberships.map((m) => ({ id: m.organization.id, name: m.organization.name, currency: m.organization.currency, timezone: m.organization.timezone, role: m.role })) });
      },
    },
    { method: "get", path: "/organizations/current", access: MembershipRole.VIEWER, handler: (req, res) => res.json(orgDTO(req)) },
    {
      method: "get",
      path: "/organizations/current/features",
      access: MembershipRole.VIEWER,
      handler: async (req, res) => res.json({ features: { moneyBrief: briefs.briefEnabled(await briefOrg(req)) } }),
    },
    {
      // Owner-only: feature flags are product decisions (the brief shares metrics with a model vendor when a key is set).
      method: "patch",
      path: "/organizations/current/features",
      access: MembershipRole.OWNER,
      handler: chain(validateBody(featuresSchema), async (req, res) => {
        const patch = body<typeof featuresSchema>(req);
        const current = ((await db.organization.findUnique({ where: { id: req.org!.id }, select: { featureFlags: true } }))?.featureFlags ?? {}) as Record<string, unknown>;
        const next = { ...current, ...patch };
        await db.organization.update({ where: { id: req.org!.id }, data: { featureFlags: next } });
        await db.auditLog.create({ data: { organizationId: req.org!.id, actorUserId: req.user!.id, action: "organization.features.update", entityType: "Organization", entityId: req.org!.id, before: current as Prisma.InputJsonValue, after: next as Prisma.InputJsonValue, requestId: req.id } });
        res.json({ features: { moneyBrief: next.moneyBrief === true } });
      }),
    },

    // --- accounts (chart) -------------------------------------------------
    { method: "get", path: "/accounts", access: MembershipRole.VIEWER, handler: async (req, res) => res.json({ data: await txns.accounts(req.org!.id) }) },

    // --- dashboard --------------------------------------------------------
    { method: "get", path: "/dashboard", access: MembershipRole.VIEWER, handler: async (req, res) => res.json(await dashboard.get(req.org!.id, req.org!.currency, req.org!.timezone)) },
    // --- weekly brief (plan E8): one per org per week; generated on first read; regenerate capped ---
    {
      method: "get",
      path: "/briefs/current",
      access: MembershipRole.VIEWER,
      handler: async (req, res) => {
        const brief = await briefs.current(await briefOrg(req), new Date(), { peek: req.query.peek === "1" });
        res.json({ enabled: brief !== null, brief });
      },
    },
    { method: "post", path: "/briefs/current/regenerate", access: MembershipRole.ADMIN, handler: async (req, res) => res.json({ brief: await briefs.generate(await briefOrg(req), new Date(), { regenerate: true }) }) },
    { method: "post", path: "/briefs/current/email", access: MembershipRole.ADMIN, handler: async (req, res) => {
      const org = await briefOrg(req);
      const current = await briefs.current(org);
      if (!current) throw new NotFoundError("The brief is switched off for this organization", "brief_disabled");
      res.json({ sent: await briefs.emailBrief(org, current.id) });
    } },
    { method: "get", path: "/briefs", access: MembershipRole.VIEWER, handler: async (req, res) => res.json({ data: await briefs.list(req.org!.id) }) },
    { method: "get", path: "/briefs/:id", access: MembershipRole.VIEWER, handler: async (req, res) => res.json({ brief: await briefs.get(req.org!.id, req.params.id as string) }) },
    // --- metrics (plan E1): deterministic numbers with ids + display strings; cached per day ---
    { method: "get", path: "/metrics", access: MembershipRole.VIEWER, handler: async (req, res) => res.json(await metrics.get(req.org!.id, req.org!.currency, req.org!.timezone)) },

    // --- transactions -----------------------------------------------------
    { method: "get", path: "/transactions", access: MembershipRole.VIEWER, handler: async (req, res) => res.json(await txns.list(req.org!.id, listQuerySchema.parse(req.query))) },
    {
      method: "get",
      path: "/transactions/export.xlsx",
      access: MembershipRole.VIEWER,
      handler: async (req, res) => {
        const q = listQuerySchema.parse({ ...req.query, limit: 200 });
        const rows: Record<string, unknown>[] = [];
        let cursor: string | null = null;
        do {
          const page = await txns.list(req.org!.id, { ...q, cursor: cursor ?? undefined });
          for (const t of page.data) rows.push({ date: t.date, memo: t.memo, direction: t.direction === "in" ? "Money in" : "Money out", category: t.categoryName, amount: t.amountMinor / 100, account: t.bankAccount.name });
          cursor = page.nextCursor;
        } while (cursor && rows.length < 50_000);
        await sendWorkbook(res, `transactions-${q.direction ?? "all"}.xlsx`, "Transactions", [
          { header: "Date", key: "date", width: 12 },
          { header: "Description", key: "memo", width: 32 },
          { header: "Direction", key: "direction", width: 12 },
          { header: "Category", key: "category", width: 24 },
          { header: `Amount (${req.org!.currency})`, key: "amount", width: 14 },
          { header: "Account", key: "account", width: 20 },
        ], rows);
      },
    },
    { method: "post", path: "/transactions", access: MembershipRole.BOOKKEEPER, handler: chain(validateBody(createSchema), async (req, res) => res.status(201).json(await txns.create(req.org!.id, body<typeof createSchema>(req), actor(req)))) },
    { method: "get", path: "/transactions/:id", access: MembershipRole.VIEWER, example: FOREIGN, handler: async (req, res) => res.json(await txns.get(req.org!.id, param(req, "id"))) },
    { method: "patch", path: "/transactions/:id", access: MembershipRole.BOOKKEEPER, example: FOREIGN, handler: chain(validateBody(updateSchema), async (req, res) => res.json(await txns.update(req.org!.id, param(req, "id"), body<typeof updateSchema>(req), actor(req)))) },
    { method: "post", path: "/transactions/:id/reverse", access: MembershipRole.BOOKKEEPER, example: FOREIGN, handler: async (req, res) => res.json(await txns.reverse(req.org!.id, param(req, "id"), actor(req))) },
    // DELETE is an alias for reverse: posted entries never disappear (ADR 0004).
    { method: "delete", path: "/transactions/:id", access: MembershipRole.BOOKKEEPER, example: FOREIGN, handler: async (req, res) => res.json({ message: "Transaction reversed", ...(await txns.reverse(req.org!.id, param(req, "id"), actor(req))) }) },

    // --- bank feeds (plan 1.4b) ---------------------------------------------
    { method: "get", path: "/bank-connections/provider", access: MembershipRole.VIEWER, handler: async (_req, res) => res.json(feeds.provider) },
    { method: "get", path: "/bank-connections", access: MembershipRole.VIEWER, handler: async (req, res) => res.json({ data: await feeds.list(req.org!.id) }) },
    { method: "post", path: "/bank-connections/link-token", access: MembershipRole.BOOKKEEPER, handler: async (req, res) => res.json(await feeds.linkToken(req.org!.id, req.user!.id)) },
    {
      method: "post",
      path: "/bank-connections",
      access: MembershipRole.BOOKKEEPER,
      handler: chain(validateBody(connectSchema), async (req, res) => res.status(201).json(await feeds.connect(req.org!.id, req.org!.currency, body<typeof connectSchema>(req), actor(req)))),
    },
    { method: "get", path: "/bank-connections/:id", access: MembershipRole.VIEWER, example: FOREIGN, handler: async (req, res) => res.json(await feeds.get(req.org!.id, req.params.id as string)) },
    { method: "post", path: "/bank-connections/:id/link-token", access: MembershipRole.BOOKKEEPER, example: FOREIGN, handler: async (req, res) => res.json(await feeds.linkToken(req.org!.id, req.user!.id, req.params.id as string)) },
    { method: "post", path: "/bank-connections/:id/sync", access: MembershipRole.BOOKKEEPER, example: FOREIGN, handler: async (req, res) => res.json(await feeds.sync(req.org!.id, req.params.id as string, actor(req))) },
    { method: "post", path: "/bank-connections/:id/reconnected", access: MembershipRole.BOOKKEEPER, example: FOREIGN, handler: async (req, res) => res.json(await feeds.reconnected(req.org!.id, req.params.id as string, actor(req))) },
    {
      method: "delete",
      path: "/bank-connections/:id",
      access: MembershipRole.ADMIN,
      example: FOREIGN,
      handler: async (req, res) => {
        await feeds.disconnect(req.org!.id, req.params.id as string, actor(req));
        res.json({ message: "Bank disconnected; its transactions stay in your books" });
      },
    },

    // --- bank accounts ----------------------------------------------------
    { method: "get", path: "/bank-accounts", access: MembershipRole.VIEWER, handler: async (req, res) => res.json({ data: await banks.list(req.org!.id) }) },
    { method: "post", path: "/bank-accounts", access: MembershipRole.BOOKKEEPER, handler: chain(validateBody(createBankAccountSchema), async (req, res) => res.status(201).json(await banks.create(req.org!.id, req.org!.currency, body<typeof createBankAccountSchema>(req), req.user!.id))) },

    // --- imports (CSV) ----------------------------------------------------
    { method: "get", path: "/imports", access: MembershipRole.VIEWER, handler: async (req, res) => res.json({ data: await imports.list(req.org!.id) }) },
    {
      method: "post",
      path: "/imports",
      access: MembershipRole.BOOKKEEPER,
      handler: chain(upload.single("file") as RequestHandler, async (req, res) => {
        const file = (req as Request & { file?: Express.Multer.File }).file;
        const bankAccountId = z.string().uuid().safeParse(req.body?.bankAccountId);
        if (!file) throw new ValidationErrorForRoute("Choose a CSV file", "file");
        if (!bankAccountId.success) throw new ValidationErrorForRoute("Choose the bank account this statement belongs to", "bankAccountId");
        res.status(201).json(await imports.upload(req.org!.id, bankAccountId.data, file.originalname, file.buffer, actor(req)));
      }),
    },
    { method: "get", path: "/imports/:id", access: MembershipRole.VIEWER, example: FOREIGN, handler: async (req, res) => res.json(await imports.get(req.org!.id, param(req, "id"))) },
    { method: "get", path: "/imports/:id/preview", access: MembershipRole.VIEWER, example: FOREIGN, handler: async (req, res) => res.json(await imports.preview(req.org!.id, param(req, "id"))) },
    { method: "post", path: "/imports/:id/mapping", access: MembershipRole.BOOKKEEPER, example: FOREIGN, handler: async (req, res) => res.json(await imports.setMapping(req.org!.id, param(req, "id"), req.body)) },
    { method: "post", path: "/imports/:id/commit", access: MembershipRole.BOOKKEEPER, example: FOREIGN, handler: async (req, res) => res.json(await imports.commit(req.org!.id, param(req, "id"), req.body ?? {}, actor(req))) },

    // --- categorization rules ---------------------------------------------
    { method: "get", path: "/rules", access: MembershipRole.VIEWER, handler: async (req, res) => res.json({ data: await rules.list(req.org!.id) }) },
    { method: "post", path: "/rules", access: MembershipRole.BOOKKEEPER, handler: chain(validateBody(createRuleSchema), async (req, res) => res.status(201).json(await rules.create(req.org!.id, body<typeof createRuleSchema>(req), actor(req)))) },
    { method: "delete", path: "/rules/:id", access: MembershipRole.BOOKKEEPER, example: FOREIGN, handler: async (req, res) => { await rules.remove(req.org!.id, param(req, "id"), actor(req)); res.json({ message: "Rule removed" }); } },
  ];
}

export function buildRouter(db: Db, config: Config, deps: RouteDeps): Router {
  const auth = authService(db, config, deps.email, deps.logger);
  const router = Router();
  for (const route of routeTable(db, config, deps)) {
    const guards: RequestHandler[] = [];
    if (route.access !== "public") guards.push(protect(auth));
    if (route.access !== "public" && route.access !== "auth") guards.push(requireOrg(db, auth, route.access));
    router[route.method](route.path, ...guards, route.handler);
  }
  return router;
}

const uuid = z.string().uuid();
function param(req: Request, name: string): string {
  const value = req.params[name];
  const parsed = uuid.safeParse(value);
  if (!parsed.success) {
    // A malformed id can never exist; answer like a foreign id would (404), not 400.
    return "00000000-0000-0000-0000-000000000000";
  }
  return parsed.data;
}

/** Runs middleware then the handler as one RequestHandler (keeps the table flat). */
function chain(mw: RequestHandler, handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    try {
      mw(req, res, (err?: unknown) => {
        if (err) return next(err);
        handler(req, res).catch(next);
      });
    } catch (err) {
      next(err);
    }
  };
}
