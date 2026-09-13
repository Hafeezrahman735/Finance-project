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
/** "true"/"1"/"yes" → true, "false"/"0"/"no"/"" → false (z.coerce.boolean would make "false" true). */
const envBool = (fallback: boolean) => z.preprocess((v) => (v === undefined || v === "" ? fallback : ["1", "true", "yes", "on"].includes(String(v).toLowerCase())), z.boolean());

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
  /** Optional: without it the weekly brief is the deterministic summary (AI_PROVIDER=off). */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /** anthropic = live model; recorded = replay cassettes in BRIEF_CASSETTE_DIR (CI); off = deterministic summary only. */
  AI_PROVIDER: z.enum(["anthropic", "recorded", "off"]).optional(),
  AI_MODEL: z.string().default("claude-opus-5"),
  BRIEF_CASSETTE_DIR: z.string().default("fixtures/cassettes/brief"),
  /** With AI_PROVIDER=anthropic, also write each live response into BRIEF_CASSETTE_DIR for later recorded runs. */
  BRIEF_RECORD: envBool(false),
  /** Bank feeds (plan 1.4b). With client id + secret the provider is Plaid (PLAID_ENV); without them the offline fixture bank. */
  PLAID_CLIENT_ID: z.string().min(1).optional(),
  PLAID_SECRET: z.string().min(1).optional(),
  PLAID_ENV: z.enum(["sandbox", "production", "fixture"]).optional(),
  /** 32-byte key (64 hex chars) for access tokens at rest. Required with Plaid in production; derived from JWT_SECRET otherwise (with a warning). */
  TOKEN_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "must be 64 hex characters (openssl rand -hex 32)").optional(),
  /** Comma-separated previous keys, kept until every row has re-encrypted under the current one. */
  TOKEN_ENCRYPTION_KEY_PREVIOUS: z.string().optional(),
  /** Per-IP/per-email limits on /auth/* (pre-tester prerequisite). Off only for tests. */
  AUTH_RATE_LIMIT: envBool(true),
  /** Express "trust proxy" setting when behind a load balancer ("1", "true", or a CIDR list) so req.ip is the client. */
  TRUST_PROXY: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().default(8000),
  CLIENT_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "silent"]).default("info"),
});

export type Config = z.infer<typeof schema>;

/** Cross-field rules that zod's object schema cannot express in one place. */
function refine(c: Config): string[] {
  const problems: string[] = [];
  if ((c.PLAID_CLIENT_ID && !c.PLAID_SECRET) || (!c.PLAID_CLIENT_ID && c.PLAID_SECRET)) problems.push("PLAID_CLIENT_ID and PLAID_SECRET must be set together (docs/setup.md#bank-feeds)");
  if (c.PLAID_ENV === "production" && !(c.PLAID_CLIENT_ID && c.PLAID_SECRET)) problems.push("PLAID_ENV=production needs PLAID_CLIENT_ID and PLAID_SECRET");
  if (c.NODE_ENV === "production" && c.PLAID_CLIENT_ID && !c.TOKEN_ENCRYPTION_KEY) problems.push("TOKEN_ENCRYPTION_KEY is required to store bank access tokens in production (openssl rand -hex 32)");
  return problems;
}

const docsFor: Record<string, string> = {
  DATABASE_URL: "docs/setup.md#4-configure-the-api",
  JWT_SECRET: "docs/setup.md#4-configure-the-api",
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (result.success) {
    const problems = refine(result.data);
    if (problems.length) throw new Error(problems.map((p) => `Config error: ${p}.`).join("\n"));
    return result.data;
  }

  const lines = result.error.issues.map((issue) => {
    const name = String(issue.path[0] ?? "config");
    const reason = issue.code === "invalid_type" && issue.received === "undefined" ? "is missing" : issue.message;
    const hint = docsFor[name] ? ` Copy .env.example to .env and set it (${docsFor[name]}).` : "";
    return `Config error: ${name} ${reason}.${hint}`;
  });
  throw new Error(lines.join("\n"));
}
