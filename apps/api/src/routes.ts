import { Router, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import type { Config } from "./config.js";
import type { Db } from "./db/prisma.js";
import { MembershipRole } from "./generated/prisma/enums.js";
import { ValidationError as ValidationErrorForRoute } from "./lib/errors.js";
import { sendWorkbook } from "./lib/excel.js";
import { protect, requireOrg } from "./middleware/auth.js";
import { body, validateBody } from "./middleware/validate.js";
import type { Logger } from "pino";
import { authService, forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema, toUserDTO, verifyEmailSchema, type AuthResult } from "./services/auth/auth.js";
import type { EmailSink } from "./services/email/email.js";
import { bankAccountsService, createBankAccountSchema } from "./services/banking/bankAccounts.js";
import { importsService, MAX_FILE_BYTES } from "./services/banking/imports.js";
import { createRuleSchema, rulesService } from "./services/rules/rules.js";
import { dashboardService } from "./services/dashboard/dashboard.js";
import { metricsService } from "./services/metrics/metrics.js";
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

export interface RouteDeps {
  email: EmailSink;
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
  const txns = transactionsService(db);
  const dashboard = dashboardService(db);
  const metrics = metricsService(db);
  const banks = bankAccountsService(db);
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
      handler: chain(validateBody(registerSchema), async (req, res) => {
        const r = await auth.register(body<typeof registerSchema>(req), req.get("user-agent"));
        setRefresh(res, r.refreshToken);
        res.status(201).json(withoutRefresh(r));
      }),
    },
    {
      method: "post",
      path: "/auth/login",
      access: "public",
      handler: chain(validateBody(loginSchema), async (req, res) => {
        const r = await auth.login(body<typeof loginSchema>(req), req.get("user-agent"));
        setRefresh(res, r.refreshToken);
        res.json(withoutRefresh(r));
      }),
    },
    {
      method: "post",
      path: "/auth/refresh",
      access: "public",
      handler: async (req, res) => {
        try {
          const r = await auth.refresh(readRefresh(req), req.get("user-agent"));
          setRefresh(res, r.refreshToken);
          res.json({ token: r.token, user: r.user });
        } catch (err) {
          clearRefresh(res);
          throw err;
        }
      },
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
      handler: chain(validateBody(forgotPasswordSchema), async (req, res) => {
        await auth.forgotPassword(body<typeof forgotPasswordSchema>(req));
        res.json({ message: "If that email has an account, a reset link is on its way" });
      }),
    },
    {
      method: "post",
      path: "/auth/reset-password",
      access: "public",
      handler: chain(validateBody(resetPasswordSchema), async (req, res) => {
        await auth.resetPassword(body<typeof resetPasswordSchema>(req));
        res.json({ message: "Password updated; log in with the new one" });
      }),
    },
    { method: "post", path: "/auth/verify-email", access: "public", handler: chain(validateBody(verifyEmailSchema), async (req, res) => res.json({ user: await auth.verifyEmail(body<typeof verifyEmailSchema>(req)) })) },
    {
      method: "post",
      path: "/auth/resend-verification",
      access: "auth",
      handler: async (req, res) => {
        await auth.resendVerification(req.user!.id);
        res.json({ message: "Verification email sent" });
      },
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

    // --- accounts (chart) -------------------------------------------------
    { method: "get", path: "/accounts", access: MembershipRole.VIEWER, handler: async (req, res) => res.json({ data: await txns.accounts(req.org!.id) }) },

    // --- dashboard --------------------------------------------------------
    { method: "get", path: "/dashboard", access: MembershipRole.VIEWER, handler: async (req, res) => res.json(await dashboard.get(req.org!.id, req.org!.currency, req.org!.timezone)) },
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
