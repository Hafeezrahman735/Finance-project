import type { NextFunction, Request, Response } from "express";
import type { Db } from "../db/prisma.js";
import { MembershipRole } from "../generated/prisma/enums.js";
import { AuthenticationError, ForbiddenError, NotFoundError } from "../lib/errors.js";
import type { AuthService } from "../services/auth/auth.js";

export interface AuthedUser {
  id: string;
  email: string;
  fullName: string;
  createdAt: Date;
}

export interface OrgContext {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  role: MembershipRole;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthedUser;
    org?: OrgContext;
  }
}

/** Bearer token → req.user. */
export function protect(auth: AuthService) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.get("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token) throw new AuthenticationError("Not authorized, no token", "missing_token");
    const user = await auth.authenticate(token);
    req.user = { id: user.id, email: user.email, fullName: user.fullName, createdAt: user.createdAt };
    next();
  };
}

/** Role order for "at least this role" checks. */
const RANK: Record<MembershipRole, number> = {
  [MembershipRole.VIEWER]: 0,
  [MembershipRole.ACCOUNTANT]: 1,
  [MembershipRole.BOOKKEEPER]: 2,
  [MembershipRole.ADMIN]: 3,
  [MembershipRole.OWNER]: 4,
};

export function roleAtLeast(role: MembershipRole, min: MembershipRole): boolean {
  return RANK[role] >= RANK[min];
}

/**
 * Resolves the active organization (ADR 0003):
 *   X-Organization-Id header if present, else the user's primary organization.
 * Asserts membership, then role >= `minRole`. A foreign or unknown organization
 * id yields 404, never 403, so ids cannot be probed.
 */
export function requireOrg(db: Db, auth: AuthService, minRole: MembershipRole = MembershipRole.VIEWER) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AuthenticationError();
    const requested = req.get("x-organization-id");
    let org: OrgContext;
    if (requested) {
      const m = await db.membership.findUnique({
        where: { organizationId_userId: { organizationId: requested, userId: req.user.id } },
        include: { organization: true },
      }).catch(() => null); // malformed uuid → treat as not found
      if (!m) throw new NotFoundError("Organization not found", "organization_not_found");
      org = { id: m.organization.id, name: m.organization.name, currency: m.organization.currency, timezone: m.organization.timezone, role: m.role };
    } else {
      org = await auth.primaryOrganization(req.user.id);
    }
    if (!roleAtLeast(org.role, minRole)) {
      throw new ForbiddenError(`This action needs the ${minRole.toLowerCase()} role or higher`, "insufficient_role");
    }
    req.org = org;
    next();
  };
}
