import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { Db } from "../../db/prisma.js";
import { MembershipRole } from "../../generated/prisma/enums.js";
import { AuthenticationError, ConflictError } from "../../lib/errors.js";
import { seedDefaultChart } from "../ledger/chart.js";

/**
 * Email/password auth on Postgres. Signup creates the user, their first
 * organization, an OWNER membership, and the default chart in one
 * transaction (ADR 0003). Refresh tokens, password reset, and email
 * verification arrive in the auth lane (plan 1.1); this PR keeps the
 * short-lived access JWT the web app already stores.
 */

export const registerSchema = z.object({
  fullName: z.string().trim().min(1, "is required").max(120),
  email: z.string().trim().email("must be a valid email address").transform((e) => e.toLowerCase()),
  password: z.string().min(8, "must be at least 8 characters").max(200),
  /** Business name; defaults to "<fullName>'s books". Becomes one field on the signup screen. */
  organizationName: z.string().trim().min(1).max(120).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email("must be a valid email address").transform((e) => e.toLowerCase()),
  password: z.string().min(1, "is required"),
});

export interface UserDTO {
  id: string;
  fullName: string;
  email: string;
  createdAt: string;
}

export interface OrganizationDTO {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  role: MembershipRole;
}

export interface AuthResult {
  id: string;
  user: UserDTO;
  organization: OrganizationDTO;
  token: string;
}

export function toUserDTO(u: { id: string; fullName: string; email: string; createdAt: Date }): UserDTO {
  return { id: u.id, fullName: u.fullName, email: u.email, createdAt: u.createdAt.toISOString() };
}

export function authService(db: Db, config: Pick<Config, "JWT_SECRET" | "JWT_EXPIRES_IN">) {
  const sign = (userId: string) => jwt.sign({ sub: userId }, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] });

  async function primaryOrganization(userId: string): Promise<OrganizationDTO> {
    // OWNER memberships first, then oldest. Users with several orgs pick via X-Organization-Id.
    const m = await db.membership.findFirst({
      where: { userId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      include: { organization: true },
    });
    if (!m) throw new AuthenticationError("This account has no organization", "no_organization");
    return { id: m.organization.id, name: m.organization.name, currency: m.organization.currency, timezone: m.organization.timezone, role: m.role };
  }

  return {
    async register(input: z.infer<typeof registerSchema>): Promise<AuthResult> {
      if (await db.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
        throw new ConflictError("An account with this email already exists", "email_taken");
      }
      const passwordHash = await bcrypt.hash(input.password, 10);
      const user = await db.$transaction(async (tx) => {
        const u = await tx.user.create({ data: { email: input.email, fullName: input.fullName, passwordHash } });
        const org = await tx.organization.create({
          data: {
            name: input.organizationName ?? `${input.fullName}'s books`,
            ...(input.timezone ? { timezone: input.timezone } : {}),
            memberships: { create: { userId: u.id, role: MembershipRole.OWNER } },
          },
        });
        await seedDefaultChart(tx, org.id);
        return u;
      });
      return { id: user.id, user: toUserDTO(user), organization: await primaryOrganization(user.id), token: sign(user.id) };
    },

    async login(input: z.infer<typeof loginSchema>): Promise<AuthResult> {
      const user = await db.user.findUnique({ where: { email: input.email } });
      if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
        throw new AuthenticationError("Invalid email or password", "invalid_credentials");
      }
      return { id: user.id, user: toUserDTO(user), organization: await primaryOrganization(user.id), token: sign(user.id) };
    },

    /** Resolves a bearer token to a user, or throws AuthenticationError. */
    async authenticate(token: string) {
      let payload: { sub?: string };
      try {
        payload = jwt.verify(token, config.JWT_SECRET) as { sub?: string };
      } catch {
        throw new AuthenticationError("Not authorized, token failed", "invalid_token");
      }
      const user = payload.sub ? await db.user.findUnique({ where: { id: payload.sub } }) : null;
      if (!user) throw new AuthenticationError("Not authorized, user no longer exists", "unknown_user");
      return user;
    },

    primaryOrganization,
  };
}

export type AuthService = ReturnType<typeof authService>;
