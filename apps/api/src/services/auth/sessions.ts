import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Db } from "../../db/prisma.js";
import { AuthenticationError } from "../../lib/errors.js";

/**
 * Refresh-token sessions (plan 1.1, eng review F10).
 *
 *   login ──▶ family F, token t1 ──refresh──▶ t1.usedAt set, t2 issued (same family)
 *                                              │
 *                          t1 presented again ─┤ within GRACE_MS of t1.usedAt → two-tab race: rotate from the
 *                                              │   family's newest live token instead of failing
 *                                              └ later → reuse (stolen or replayed): revoke the whole family, 401
 *
 * Tokens are 256-bit random strings; only their SHA-256 is stored. The raw
 * token lives in an httpOnly cookie scoped to /api/v1/auth.
 */
export const GRACE_MS = 10_000;

const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");

export function sessionsService(db: Db, opts: { refreshDays: number }) {
  const ttl = () => new Date(Date.now() + opts.refreshDays * 24 * 60 * 60 * 1000);

  async function issue(userId: string, familyId: string, userAgent?: string | null): Promise<string> {
    const raw = randomBytes(32).toString("base64url");
    await db.refreshToken.create({ data: { userId, familyId, tokenHash: hash(raw), expiresAt: ttl(), userAgent: userAgent?.slice(0, 200) ?? null } });
    return raw;
  }

  return {
    /** New family on login/register. Returns the raw token for the cookie. */
    async start(userId: string, userAgent?: string | null): Promise<string> {
      return issue(userId, randomUUID(), userAgent);
    },

    /** Rotate: validates the presented token and returns { userId, token } for the new cookie. */
    async rotate(raw: string | undefined, userAgent?: string | null): Promise<{ userId: string; token: string }> {
      if (!raw) throw new AuthenticationError("Session expired; please log in again", "refresh_missing");
      const current = await db.refreshToken.findUnique({ where: { tokenHash: hash(raw) } });
      if (!current) throw new AuthenticationError("Session expired; please log in again", "refresh_invalid");
      const now = new Date();
      if (current.revokedAt) throw new AuthenticationError("Session was signed out; please log in again", "refresh_revoked");
      if (current.expiresAt < now) throw new AuthenticationError("Session expired; please log in again", "refresh_expired");

      if (current.usedAt) {
        if (now.getTime() - current.usedAt.getTime() <= GRACE_MS) {
          // Two tabs refreshed at once: keep the family alive by rotating from its newest live token.
          const newest = await db.refreshToken.findFirst({ where: { familyId: current.familyId, usedAt: null, revokedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });
          if (newest) {
            await db.refreshToken.update({ where: { id: newest.id }, data: { usedAt: now } });
            return { userId: current.userId, token: await issue(current.userId, current.familyId, userAgent) };
          }
        }
        // Reuse outside the grace window: someone replayed an old token. Kill the family.
        await db.refreshToken.updateMany({ where: { familyId: current.familyId, revokedAt: null }, data: { revokedAt: now } });
        throw new AuthenticationError("This session was used from another place and has been signed out everywhere. Please log in again.", "refresh_reused");
      }

      await db.refreshToken.update({ where: { id: current.id }, data: { usedAt: now } });
      return { userId: current.userId, token: await issue(current.userId, current.familyId, userAgent) };
    },

    /** Logout: revoke the family the presented token belongs to (no error if unknown). */
    async revoke(raw: string | undefined): Promise<void> {
      if (!raw) return;
      const current = await db.refreshToken.findUnique({ where: { tokenHash: hash(raw) }, select: { familyId: true } });
      if (!current) return;
      await db.refreshToken.updateMany({ where: { familyId: current.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    },

    /** Logout everywhere (also used after a password reset). */
    async revokeAll(userId: string): Promise<number> {
      const r = await db.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      return r.count;
    },
  };
}

export type SessionsService = ReturnType<typeof sessionsService>;
