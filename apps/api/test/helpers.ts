import pino from "pino";
import request from "supertest";
import { createApp } from "../src/app.js";
import type { Config } from "../src/config.js";

export const testConfig: Config = {
  NODE_ENV: "test",
  MONGO_URL: "unused-in-tests",
  JWT_SECRET: "test-secret-at-least-16-chars",
  JWT_EXPIRES_IN: "1h",
  PORT: 0,
  CLIENT_URL: undefined,
  LOG_LEVEL: "silent",
};

export function makeApp(config: Partial<Config> = {}) {
  return createApp({ ...testConfig, ...config }, pino({ level: "silent" }));
}

export async function signup(app: ReturnType<typeof makeApp>, email = "owner@example.com") {
  const res = await request(app)
    .post("/api/v1/auth/register")
    .send({ fullName: "Owner One", email, password: "correct-horse-battery" });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.token as string, user: res.body.user as { id: string; email: string } };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
