import pino from "pino";
import request from "supertest";
import { createApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import type { Db } from "../src/db/prisma.js";
import type { RouteDeps } from "../src/routes.js";
import { CapturingEmailSink } from "../src/services/email/email.js";
import { MembershipRole } from "../src/generated/prisma/enums.js";

export const testConfig: Config = {
  NODE_ENV: "test",
  DATABASE_URL: "unused-in-tests (see test/pg.ts)",
  JWT_SECRET: "test-secret-at-least-16-chars",
  JWT_EXPIRES_IN: "15m",
  REFRESH_TOKEN_DAYS: 30,
  APP_URL: "http://localhost:5173",
  RESEND_API_KEY: undefined,
  EMAIL_FROM: "LedgerIQ <test@example.com>",
  PORT: 0,
  CLIENT_URL: undefined,
  LOG_LEVEL: "silent",
};

export function makeApp(db: Db, config: Partial<Config> = {}, deps: Partial<RouteDeps> = {}) {
  return createApp(db, { ...testConfig, ...config }, pino({ level: "silent" }), { email: new CapturingEmailSink(), ...deps });
}

export interface Session {
  token: string;
  user: { id: string; email: string; fullName: string; emailVerifiedAt: string | null };
  organization: { id: string; name: string; currency: string; timezone: string; role: MembershipRole };
}

export async function signup(app: ReturnType<typeof makeApp>, email = `owner-${Math.random().toString(36).slice(2, 8)}@example.com`, organizationName?: string): Promise<Session> {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ fullName: "Owner One", email, password: "correct-horse-battery", ...(organizationName ? { organizationName } : {}), timezone: "America/Chicago" });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as Session;
}

/** Adds a second user to `session`'s organization with `role` and returns their session. */
export async function invite(app: ReturnType<typeof makeApp>, db: Db, session: Session, role: MembershipRole): Promise<Session> {
  const member = await signup(app, `member-${role.toLowerCase()}-${Math.random().toString(36).slice(2, 6)}@example.com`);
  await db.membership.create({ data: { organizationId: session.organization.id, userId: member.user.id, role } });
  return { ...member, organization: { ...session.organization, role } };
}

export const auth = (session: Session | string, organizationId?: string) => ({
  Authorization: `Bearer ${typeof session === "string" ? session : session.token}`,
  ...(organizationId ? { "X-Organization-Id": organizationId } : typeof session !== "string" ? { "X-Organization-Id": session.organization.id } : {}),
});
