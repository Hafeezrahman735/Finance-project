import request from "supertest";
import { describe, expect, it } from "vitest";
import { auth, makeApp, signup } from "./helpers.js";
import { describePg, usePg } from "./pg.js";

const run = describePg() ? describe : describe.skip;

run("auth", () => {
  const db = usePg();
  const app = () => makeApp(db());

  it("registers: user + organization + owner membership + default chart, no password hash anywhere", async () => {
    const res = await request(app())
      .post("/api/v1/auth/register")
      .send({ fullName: "Ada", email: "Ada@Example.com", password: "correct-horse-battery", organizationName: "Ada Analytics" });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTypeOf("string");
    expect(res.body.user).toMatchObject({ fullName: "Ada", email: "ada@example.com" });
    expect(res.body.organization).toMatchObject({ name: "Ada Analytics", currency: "USD", role: "OWNER" });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const accounts = await db().account.count({ where: { organizationId: res.body.organization.id } });
    expect(accounts).toBeGreaterThan(20);
    const memberships = await db().membership.findMany({ where: { userId: res.body.user.id } });
    expect(memberships).toHaveLength(1);
  });

  it("defaults the organization name and rejects duplicate emails with 409", async () => {
    const first = await signup(app(), "dup@example.com");
    expect(first.organization.name).toBe("Owner One's books");
    const res = await request(app()).post("/api/v1/auth/register").send({ fullName: "Dup", email: "DUP@example.com", password: "correct-horse-battery" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ type: "conflict", code: "email_taken" });
    expect(res.body.message).toBe(res.body.error.message);
    expect(res.body.error.requestId).toBeTypeOf("string");
  });

  it("validates the register body and names the bad param", async () => {
    const res = await request(app()).post("/api/v1/auth/register").send({ fullName: "", email: "nope", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "invalid_param", param: "fullName" });
  });

  it("logs in with the right password, rejects the wrong one, and a migrated bcrypt hash still works", async () => {
    await signup(app(), "login@example.com");
    const ok = await request(app()).post("/api/v1/auth/login").send({ email: "login@example.com", password: "correct-horse-battery" });
    expect(ok.status).toBe(200);
    expect(ok.body.organization.role).toBe("OWNER");
    const bad = await request(app()).post("/api/v1/auth/login").send({ email: "login@example.com", password: "wrong" });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("invalid_credentials");

    // A user row created by the Mongo migration carries the old bcryptjs hash unchanged.
    const bcrypt = await import("bcryptjs");
    await db().user.create({ data: { email: "legacy@example.com", fullName: "Legacy", passwordHash: await bcrypt.default.hash("old-password", 10), legacyMongoId: "abc123" } });
    const noOrg = await request(app()).post("/api/v1/auth/login").send({ email: "legacy@example.com", password: "old-password" });
    expect(noOrg.status).toBe(401);
    expect(noOrg.body.error.code).toBe("no_organization"); // migration always creates one; this proves the guard
  });

  it("/auth/me requires a valid token and returns the primary organization", async () => {
    const s = await signup(app());
    expect((await request(app()).get("/api/v1/auth/me")).status).toBe(401);
    expect((await request(app()).get("/api/v1/auth/me").set(auth("garbage"))).status).toBe(401);
    const me = await request(app()).get("/api/v1/auth/me").set(auth(s.token));
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(s.user.email);
    expect(me.body.organization.id).toBe(s.organization.id);
  });

  it("returns 400 invalid_json for a malformed body, 404 for unknown routes, and echoes X-Request-Id", async () => {
    const bad = await request(app()).post("/api/v1/auth/login").set("Content-Type", "application/json").send("{not json");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("invalid_json");
    const missing = await request(app()).get("/api/v1/nope");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("route_not_found");
    const health = await request(app()).get("/healthz").set("X-Request-Id", "abc-123");
    expect(health.headers["x-request-id"]).toBe("abc-123");
    expect(health.body).toEqual({ ok: true });
  });
});
