import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Logger } from "pino";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { Db } from "../../db/prisma.js";
import { AuthTokenPurpose, MembershipRole } from "../../generated/prisma/enums.js";
import { AuthenticationError, ConflictError, ValidationError } from "../../lib/errors.js";
import { templates, type EmailSink } from "../email/email.js";
import { seedDefaultChart } from "../ledger/chart.js";
import { sessionsService } from "./sessions.js";

/**
 * Email/password auth on Postgres (plan 1.1).
 *   register  user + organization + OWNER membership + chart in one transaction (ADR 0003); verification email
 *   login     short-lived access JWT (sub = user id) + refresh-token family (httpOnly cookie)
 *   refresh   rotate the refresh token, mint a new access token
 *   logout    revoke the family; logoutAll revokes every session
 *   forgot / reset password   one-time hashed token, 1 hour; reset signs out everywhere
 *   verify email              one-time hashed token, 24 hours
 */

export const registerSchema = z.object({
  fullName: z.string().trim().min(1, "is required").max(120),
  email: z.string().trim().email("must be a valid email address").transform((e) => e.toLowerCase()),
  password: z.string().min(8, "must be at least 8 characters").max(200),
  organizationName: z.string().trim().min(1).max(120).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email("must be a valid email address").transform((e) => e.toLowerCase()),
  password: z.string().min(1, "is required"),
});

export const forgotPasswordSchema = z.object({ email: z.string().trim().email().transform((e) => e.toLowerCase()) });
export const resetPasswordSchema = z.object({ token: z.string().min(20), password: z.string().min(8, "must be at least 8 characters").max(200) });
export const verifyEmailSchema = z.object({ token: z.string().min(20) });

export interface UserDTO {
  id: string;
  fullName: string;
  email: string;
  emailVerifiedAt: string | null;
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
  /** Raw refresh token for the cookie; never in the JSON body. */
  refreshToken: string;
}

export function toUserDTO(u: { id: string; fullName: string; email: string; emailVerifiedAt: Date | null; createdAt: Date }): UserDTO {
  return { id: u.id, fullName: u.fullName, email: u.email, emailVerifiedAt: u.emailVerifiedAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString() };
}

const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex");
const HOUR = 60 * 60 * 1000;

export function authService(db: Db, config: Pick<Config, "JWT_SECRET" | "JWT_EXPIRES_IN" | "REFRESH_TOKEN_DAYS" | "APP_URL">, email: EmailSink, logger?: Logger) {
  const sessions = sessionsService(db, { refreshDays: config.REFRESH_TOKEN_DAYS });
  const sign = (userId: string) => jwt.sign({ sub: userId }, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"] });

  async function primaryOrganization(userId: string): Promise<OrganizationDTO> {
    const m = await db.membership.findFirst({ where: { userId }, orderBy: [{ role: "asc" }, { createdAt: "asc" }], include: { organization: true } });
    if (!m) throw new AuthenticationError("This account has no organization", "no_organization");
    return { id: m.organization.id, name: m.organization.name, currency: m.organization.currency, timezone: m.organization.timezone, role: m.role };
  }

  async function issueOneTimeToken(userId: string, purpose: AuthTokenPurpose, ttlMs: number): Promise<string> {
    const raw = randomBytes(32).toString("base64url");
    // One live token per purpose: issuing a new one invalidates older unused ones.
    await db.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
    await db.authToken.create({ data: { userId, purpose, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + ttlMs) } });
    return raw;
  }

  async function consumeOneTimeToken(raw: string, purpose: AuthTokenPurpose): Promise<string> {
    const row = await db.authToken.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (!row || row.purpose !== purpose) throw new ValidationError("This link is not valid. Request a new one.", "token");
    if (row.usedAt) throw new ValidationError("This link was already used. Request a new one.", "token");
    if (row.expiresAt < new Date()) throw new ValidationError("This link has expired. Request a new one.", "token");
    await db.authToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return row.userId;
  }

  async function sendVerification(userId: string, to: string): Promise<void> {
    const raw = await issueOneTimeToken(userId, AuthTokenPurpose.EMAIL_VERIFY, 24 * HOUR);
    const link = `${config.APP_URL}/verify-email?token=${raw}`;
    await email.send({ to, ...templates.verifyEmail(link) }).catch((err) => logger?.error({ err }, "verification email failed"));
  }

  async function result(user: { id: string; fullName: string; email: string; emailVerifiedAt: Date | null; createdAt: Date }, userAgent?: string | null): Promise<AuthResult> {
    return { id: user.id, user: toUserDTO(user), organization: await primaryOrganization(user.id), token: sign(user.id), refreshToken: await sessions.start(user.id, userAgent) };
  }

  return {
    sessions,

    async register(input: z.infer<typeof registerSchema>, userAgent?: string | null): Promise<AuthResult> {
      if (await db.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
        throw new ConflictError("An account with this email already exists", "email_taken");
      }
      const passwordHash = await bcrypt.hash(input.password, 10);
      const user = await db.$transaction(async (tx) => {
        const u = await tx.user.create({ data: { email: input.email, fullName: input.fullName, passwordHash } });
        const org = await tx.organization.create({
          data: { name: input.organizationName ?? `${input.fullName}'s books`, ...(input.timezone ? { timezone: input.timezone } : {}), memberships: { create: { userId: u.id, role: MembershipRole.OWNER } } },
        });
        await seedDefaultChart(tx, org.id);
        return u;
      });
      await sendVerification(user.id, user.email);
      return result(user, userAgent);
    },

    async login(input: z.infer<typeof loginSchema>, userAgent?: string | null): Promise<AuthResult> {
      const user = await db.user.findUnique({ where: { email: input.email } });
      if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
        throw new AuthenticationError("Invalid email or password", "invalid_credentials");
      }
      return result(user, userAgent);
    },

    /** Rotate the refresh token and mint a new access token. */
    async refresh(rawRefresh: string | undefined, userAgent?: string | null): Promise<{ token: string; refreshToken: string; user: UserDTO }> {
      const { userId, token: refreshToken } = await sessions.rotate(rawRefresh, userAgent);
      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user) throw new AuthenticationError("Not authorized, user no longer exists", "unknown_user");
      return { token: sign(user.id), refreshToken, user: toUserDTO(user) };
    },

    async authenticate(token: string) {
      let payload: { sub?: string };
      try {
        payload = jwt.verify(token, config.JWT_SECRET) as { sub?: string };
      } catch (err) {
        const expired = (err as { name?: string }).name === "TokenExpiredError";
        throw new AuthenticationError(expired ? "Session expired" : "Not authorized, token failed", expired ? "token_expired" : "invalid_token");
      }
      const user = payload.sub ? await db.user.findUnique({ where: { id: payload.sub } }) : null;
      if (!user) throw new AuthenticationError("Not authorized, user no longer exists", "unknown_user");
      return user;
    },

    async forgotPassword(input: z.infer<typeof forgotPasswordSchema>): Promise<void> {
      // Always succeed: never reveal whether an email is registered.
      const user = await db.user.findUnique({ where: { email: input.email } });
      if (!user) return;
      const raw = await issueOneTimeToken(user.id, AuthTokenPurpose.PASSWORD_RESET, HOUR);
      await email.send({ to: user.email, ...templates.resetPassword(`${config.APP_URL}/reset-password?token=${raw}`) }).catch((err) => logger?.error({ err }, "reset email failed"));
    },

    async resetPassword(input: z.infer<typeof resetPasswordSchema>): Promise<void> {
      const userId = await consumeOneTimeToken(input.token, AuthTokenPurpose.PASSWORD_RESET);
      await db.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(input.password, 10) } });
      await sessions.revokeAll(userId); // logout everywhere
    },

    async verifyEmail(input: z.infer<typeof verifyEmailSchema>): Promise<UserDTO> {
      const userId = await consumeOneTimeToken(input.token, AuthTokenPurpose.EMAIL_VERIFY);
      const user = await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
      return toUserDTO(user);
    },

    async resendVerification(userId: string): Promise<void> {
      const user = await db.user.findUnique({ where: { id: userId } });
      if (!user) throw new AuthenticationError();
      if (user.emailVerifiedAt) return;
      await sendVerification(user.id, user.email);
    },

    primaryOrganization,
  };
}

export type AuthService = ReturnType<typeof authService>;
