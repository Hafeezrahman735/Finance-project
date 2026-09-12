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
  MONGO_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, "must be at least 16 characters"),
  JWT_EXPIRES_IN: z.string().default("1h"),
  PORT: z.coerce.number().int().positive().default(8000),
  CLIENT_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "silent"]).default("info"),
});

export type Config = z.infer<typeof schema>;

const docsFor: Record<string, string> = {
  MONGO_URL: "docs/setup.md#3-configure-the-api",
  JWT_SECRET: "docs/setup.md#3-configure-the-api",
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
