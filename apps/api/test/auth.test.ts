import request from "supertest";
import { describe, expect, it } from "vitest";
import { auth, makeApp, signup } from "./helpers.js";

const app = makeApp();

describe("auth", () => {
  it("registers, returns a token and a user DTO without the password hash", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ fullName: "Ada", email: "Ada@Example.com", password: "correct-horse-battery" });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTypeOf("string");
    expect(res.body.user).toMatchObject({ fullName: "Ada", email: "ada@example.com" });
    expect(JSON.stringify(res.body)).not.toContain("password");
    expect(res.body.user).not.toHaveProperty("_id");
  });

  it("rejects a duplicate email with 409 and a coded error envelope", async () => {
    await signup(app, "dup@example.com");
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ fullName: "Dup", email: "dup@example.com", password: "correct-horse-battery" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ type: "conflict", code: "email_taken" });
    expect(res.body.message).toBe(res.body.error.message);
    expect(res.body.error.requestId).toBeTypeOf("string");
  });

  it("validates the register body and names the bad param", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({ fullName: "", email: "nope", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_param");
    expect(res.body.error.param).toBe("fullName");
    expect(res.body.message).toContain("fullName");
  });

  it("logs in with the right password and rejects the wrong one", async () => {
    await signup(app, "login@example.com");
    const ok = await request(app).post("/api/v1/auth/login").send({ email: "login@example.com", password: "correct-horse-battery" });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTypeOf("string");
    expect(JSON.stringify(ok.body)).not.toContain("password");

    const bad = await request(app).post("/api/v1/auth/login").send({ email: "login@example.com", password: "wrong" });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("invalid_credentials");
  });

  it("getUser requires a valid token", async () => {
    const { token } = await signup(app);
    expect((await request(app).get("/api/v1/auth/getUser")).status).toBe(401);
    expect((await request(app).get("/api/v1/auth/getUser").set(auth("garbage"))).status).toBe(401);
    const me = await request(app).get("/api/v1/auth/getUser").set(auth(token));
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: "owner@example.com" });
    expect(me.body).not.toHaveProperty("password");
  });

  it("returns 400 invalid_json for a malformed body and 404 for unknown routes", async () => {
    const bad = await request(app).post("/api/v1/auth/login").set("Content-Type", "application/json").send("{not json");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("invalid_json");
    const missing = await request(app).get("/api/v1/nope");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("route_not_found");
  });

  it("echoes X-Request-Id on every response", async () => {
    const res = await request(app).get("/healthz").set("X-Request-Id", "abc-123");
    expect(res.headers["x-request-id"]).toBe("abc-123");
    expect(res.body).toEqual({ ok: true });
  });
});
