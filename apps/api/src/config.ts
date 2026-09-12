import "dotenv/config";
import { z } from "zod";

/**
 * Tiered configuration (docs/setup.md, DX decision #65).
 *
 *   required  — the process cannot start without these.
 *   optional  — have defaults or gate a feature; a missing key disables the
 *               feature with one warning instead of crashing boot. (Plaid,
 *               Anthropic, Resend keys join this tier in later PRs.)
 *
 * Every failure message names the variable and points at docs/setup.md.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, "must be at least 16 characters"),
  /** Access token lifetime. Short: refresh tokens (httpOnly cookie) keep sessions alive. */
  JWT_EXPIRES_IN: z.string().default("15m"),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Where email links point (the web app). */
  APP_URL: z.string().url().default("http://localhost:5173"),
  /** Optional: without it, emails are logged to the console instead of sent. */
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().default("LedgerIQ <onboarding@resend.dev>"),
  PORT: z.coerce.number().int().positive().default(8000),
  CLIENT_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "silent"]).default("info"),
});

export type Config = z.infer<typeof schema>;

const docsFor: Record<string, string> = {
  DATABASE_URL: "docs/setup.md#4-configure-the-api",
  JWT_SECRET: "docs/setup.md#4-configure-the-api",
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (result.success) return result.data;

  const lines = result.error.issues.map((issue) => {
    const name = String(issue.path[0] ?? "config");
    const reason = issue.code === "invalid_type" && issue.received === "undefined" ? "is missing" : issue.message;
    const hint = docsFor[name] ? ` Copy .env.example to .env and set it (${docsFor[name]}).` : "";
    return `Config error: ${name} ${reason}.${hint}`;
  });
  throw new Error(lines.join("\n"));
}
