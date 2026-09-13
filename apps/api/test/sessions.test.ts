import jwt from "jsonwebtoken";
import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { REFRESH_COOKIE, routeTable } from "../src/routes.js";
import { OffBriefModel } from "../src/services/ai/model.js";
import { CapturingEmailSink } from "../src/services/email/email.js";
import { auth, signup, testConfig } from "./helpers.js";
import { describePg, usePg } from "./pg.js";

const run = describePg() ? describe : describe.skip;

/** Extracts the refresh cookie (name=value) from a response's Set-Cookie header. */
function refreshCookie(res: request.Response): string | undefined {
  const header = res.headers["set-cookie"] as unknown as string[] | undefined;
  const line = header?.find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
  return line?.split(";")[0];
}

run("sessions and account recovery", () => {
  const db = usePg();
  const email = new CapturingEmailSink();
  const app = () => createApp(db(), testConfig, pino({ level: "silent" }), { email });

  it("login sets an httpOnly, path-scoped refresh cookie and never returns the raw token in the body", async () => {
    await signup(app(), "s@example.com");
    const res = await request(app()).post("/api/v1/auth/login").send({ email: "s@example.com", password: "correct-horse-battery" });
    const cookieLine = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith(REFRESH_COOKIE))!;
    expect(cookieLine).toMatch(/HttpOnly/i);
    expect(cookieLine).toMatch(/SameSite=Strict/i);
    expect(cookieLine).toMatch(/Path=\/api\/v1\/auth/);
    expect(res.body).not.toHaveProperty("refreshToken");
    expect(await db().refreshToken.count()).toBe(2); // signup + login
  });

  it("refresh rotates the token, keeps the family, and mints a new access token", async () => {
    const s = await signup(app(), "r@example.com");
    const login = await request(app()).post("/api/v1/auth/login").send({ email: "r@example.com", password: "correct-horse-battery" });
    const c1 = refreshCookie(login)!;
    const r1 = await request(app()).post("/api/v1/auth/refresh").set("Cookie", c1);
    expect(r1.status).toBe(200);
    expect(r1.body.token).toBeTypeOf("string");
    expect(r1.body.user.email).toBe("r@example.com");
    const c2 = refreshCookie(r1)!;
    expect(c2).not.toBe(c1);
    // the new access token works
    expect((await request(app()).get("/api/v1/auth/me").set(auth(r1.body.token))).status).toBe(200);
    // rows: signup family (1) + login family (t1 used, t2 live)
    const family = await db().refreshToken.findMany({ where: { userId: s.user.id }, orderBy: { createdAt: "asc" } });
    expect(family).toHaveLength(3);
    expect(family[1]!.usedAt).not.toBeNull();
    expect(family[2]!.usedAt).toBeNull();
    expect(family[1]!.familyId).toBe(family[2]!.familyId);
  });

  it("presenting an old token again within the grace window (two tabs) keeps the session alive", async () => {
    await signup(app(), "tabs@example.com");
    const login = await request(app()).post("/api/v1/auth/login").send({ email: "tabs@example.com", password: "correct-horse-battery" });
    const c1 = refreshCookie(login)!;
    const tabA = await request(app()).post("/api/v1/auth/refresh").set("Cookie", c1);
    const tabB = await request(app()).post("/api/v1/auth/refresh").set("Cookie", c1); // same old cookie, right away
    expect(tabA.status).toBe(200);
    expect(tabB.status).toBe(200);
    // and the newest cookie still works afterwards
    const next = await request(app()).post("/api/v1/auth/refresh").set("Cookie", refreshCookie(tabB)!);
    expect(next.status).toBe(200);
  });

  it("reuse outside the grace window revokes the whole family", async () => {
    await signup(app(), "stolen@example.com");
    const login = await request(app()).post("/api/v1/auth/login").send({ email: "stolen@example.com", password: "correct-horse-battery" });
    const c1 = refreshCookie(login)!;
    const r1 = await request(app()).post("/api/v1/auth/refresh").set("Cookie", c1);
    const c2 = refreshCookie(r1)!;
    // Age the use of c1 past the grace window.
    await db().refreshToken.updateMany({ where: { usedAt: { not: null } }, data: { usedAt: new Date(Date.now() - 60_000) } });
    const replay = await request(app()).post("/api/v1/auth/refresh").set("Cookie", c1);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("refresh_reused");
    expect((replay.headers["set-cookie"] as unknown as string[])?.some((c) => c.includes(`${REFRESH_COOKIE}=;`))).toBe(true);
    // the legitimate newer token is dead too
    const victim = await request(app()).post("/api/v1/auth/refresh").set("Cookie", c2);
    expect(victim.status).toBe(401);
    expect(victim.body.error.code).toBe("refresh_revoked");
  });

  it("rejects missing, garbage, and expired refresh cookies; an expired access token says so", async () => {
    expect((await request(app()).post("/api/v1/auth/refresh")).body.error.code).toBe("refresh_missing");
    expect((await request(app()).post("/api/v1/auth/refresh").set("Cookie", `${REFRESH_COOKIE}=nope`)).body.error.code).toBe("refresh_invalid");
    await signup(app(), "exp@example.com");
    const login = await request(app()).post("/api/v1/auth/login").send({ email: "exp@example.com", password: "correct-horse-battery" });
    await db().refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app()).post("/api/v1/auth/refresh").set("Cookie", refreshCookie(login)!)).body.error.code).toBe("refresh_expired");
    const expiredAccess = jwt.sign({ sub: login.body.user.id }, testConfig.JWT_SECRET, { expiresIn: -10 });
    const me = await request(app()).get("/api/v1/auth/me").set(auth(expiredAccess));
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe("token_expired");
  });

  it("logout revokes the current family; logout-all revokes every session", async () => {
    const s = await signup(app(), "bye@example.com");
    const login = await request(app()).post("/api/v1/auth/login").send({ email: "bye@example.com", password: "correct-horse-battery" });
    const c = refreshCookie(login)!;
    const out = await request(app()).post("/api/v1/auth/logout").set("Cookie", c);
    expect(out.status).toBe(200);
    expect((await request(app()).post("/api/v1/auth/refresh").set("Cookie", c)).body.error.code).toBe("refresh_revoked");
    // the signup family is still alive until logout-all
    const all = await request(app()).post("/api/v1/auth/logout-all").set(auth(s.token));
    expect(all.body.sessions).toBe(1);
    expect(await db().refreshToken.count({ where: { userId: s.user.id, revokedAt: null } })).toBe(0);
  });

  it("registration sends a verification email; the link verifies once and only once", async () => {
    email.sent.length = 0;
    const s = await signup(app(), "verify@example.com");
    expect(s.user.emailVerifiedAt).toBeNull();
    const msg = email.sent.find((m) => m.to === "verify@example.com" && /Confirm your email/.test(m.subject))!;
    const token = msg.text.match(/verify-email\?token=([A-Za-z0-9_-]+)/)![1];
    const ok = await request(app()).post("/api/v1/auth/verify-email").send({ token });
    expect(ok.status).toBe(200);
    expect(ok.body.user.emailVerifiedAt).toBeTypeOf("string");
    const again = await request(app()).post("/api/v1/auth/verify-email").send({ token });
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/already used/);
    // resend is a no-op once verified; the /auth/me DTO carries the flag
    await request(app()).post("/api/v1/auth/resend-verification").set(auth(s.token));
    expect((await request(app()).get("/api/v1/auth/me").set(auth(s.token))).body.user.emailVerifiedAt).toBeTypeOf("string");
  });

  it("forgot/reset password: no email enumeration, one-hour single-use link, signs out everywhere", async () => {
    email.sent.length = 0;
    await signup(app(), "forgot@example.com");
    const login = await request(app()).post("/api/v1/auth/login").send({ email: "forgot@example.com", password: "correct-horse-battery" });
    const unknown = await request(app()).post("/api/v1/auth/forgot-password").send({ email: "nobody@example.com" });
    expect(unknown.status).toBe(200);
    expect(email.sent.filter((m) => m.to === "nobody@example.com")).toHaveLength(0);

    await request(app()).post("/api/v1/auth/forgot-password").send({ email: "forgot@example.com" });
    const msg = email.sent.find((m) => m.to === "forgot@example.com" && /Reset your/.test(m.subject))!;
    const token = msg.text.match(/reset-password\?token=([A-Za-z0-9_-]+)/)![1];

    expect((await request(app()).post("/api/v1/auth/reset-password").send({ token, password: "short" })).body.error.param).toBe("password");
    const reset = await request(app()).post("/api/v1/auth/reset-password").send({ token, password: "new-horse-battery-staple" });
    expect(reset.status).toBe(200);
    // old password dead, new one works, old sessions revoked
    expect((await request(app()).post("/api/v1/auth/login").send({ email: "forgot@example.com", password: "correct-horse-battery" })).status).toBe(401);
    expect((await request(app()).post("/api/v1/auth/login").send({ email: "forgot@example.com", password: "new-horse-battery-staple" })).status).toBe(200);
    expect((await request(app()).post("/api/v1/auth/refresh").set("Cookie", refreshCookie(login)!)).body.error.code).toBe("refresh_revoked");
    // link is single use; an expired link is refused with a clear message
    expect((await request(app()).post("/api/v1/auth/reset-password").send({ token, password: "another-long-password" })).body.message).toMatch(/already used/);
    await request(app()).post("/api/v1/auth/forgot-password").send({ email: "forgot@example.com" });
    await db().authToken.updateMany({ where: { usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const token2 = email.sent.at(-1)!.text.match(/reset-password\?token=([A-Za-z0-9_-]+)/)![1];
    expect((await request(app()).post("/api/v1/auth/reset-password").send({ token: token2, password: "another-long-password" })).body.message).toMatch(/expired/);
  });

  it("rate limits login per IP+email with the error envelope, without touching other emails", async () => {
    const limitedApp = createApp(db(), { ...testConfig, AUTH_RATE_LIMIT: true }, pino({ level: "silent" }), { email });
    await signup(app(), "limit@example.com");
    for (let i = 0; i < 10; i++) {
      const r = await request(limitedApp).post("/api/v1/auth/login").send({ email: "limit@example.com", password: "wrong-password" });
      expect(r.status).toBe(401);
    }
    const blocked = await request(limitedApp).post("/api/v1/auth/login").send({ email: "limit@example.com", password: "correct-horse-battery" });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatchObject({ type: "rate_limit_error", code: "rate_limited_login" });
    expect(blocked.body.error.requestId).toBeTypeOf("string");
    expect(blocked.headers["ratelimit-policy"] ?? blocked.headers["ratelimit"]).toBeDefined();
    // a different email from the same IP is not blocked
    await signup(app(), "other@example.com");
    expect((await request(limitedApp).post("/api/v1/auth/login").send({ email: "other@example.com", password: "correct-horse-battery" })).status).toBe(200);
    // forgot-password has its own, tighter budget
    for (let i = 0; i < 5; i++) await request(limitedApp).post("/api/v1/auth/forgot-password").send({ email: "limit@example.com" });
    expect((await request(limitedApp).post("/api/v1/auth/forgot-password").send({ email: "limit@example.com" })).body.error.code).toBe("rate_limited_forgot_password");
  });

  it("the route table still declares every auth route (matrix coverage)", () => {
    const paths = routeTable(db(), testConfig, { email, briefModel: new OffBriefModel() }).map((r) => `${r.method} ${r.path}`);
    for (const p of ["post /auth/refresh", "post /auth/logout", "post /auth/logout-all", "post /auth/forgot-password", "post /auth/reset-password", "post /auth/verify-email", "post /auth/resend-verification"]) {
      expect(paths).toContain(p);
    }
  });
});
