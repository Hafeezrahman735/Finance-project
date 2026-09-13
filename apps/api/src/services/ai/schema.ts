import { z } from "zod";
import type { MetricsView } from "../metrics/metrics.js";

/**
 * The Money Brief contract (plan Phase 4, pulled into Slice 1 as E8).
 *
 * The model receives BriefInput (metrics with ids + display strings, plus the
 * deterministic anomalies) and must return MoneyBrief. Findings cite metric
 * ids; the grounding validator (grounding.ts) rejects any number that is not
 * one of the input display strings, any URL, and any markdown.
 */
export const PROMPT_VERSION = "brief-v1";

export const severitySchema = z.enum(["info", "warning", "high"]);

export const findingSchema = z.object({
  /** One or two plain sentences. Numbers must be quoted exactly as their metric display string. */
  claim: z.string().min(1).max(400),
  /** Metric ids from the input that support the claim. */
  evidence_metric_ids: z.array(z.string().min(1)).min(1).max(6),
  severity: severitySchema,
});

export const actionSchema = z.object({
  action: z.string().min(1).max(240),
  reason: z.string().min(1).max(400),
  confidence: z.enum(["low", "medium", "high"]),
});

export const moneyBriefSchema = z.object({
  /** Leads with margin for a product brand. One sentence, no markdown. */
  headline: z.string().min(1).max(280),
  /** One warm line under the headline (tone T3: terse CFO with one warm line). */
  warm_line: z.string().min(1).max(200),
  findings: z.array(findingSchema).min(1).max(5),
  suggested_actions: z.array(actionSchema).min(1).max(3),
  disclaimer: z.string().min(1).max(300),
});

/** The same contract as JSON Schema for the API's structured-output format (the SDK's zod helper needs zod 4). */
export const MONEY_BRIEF_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "warm_line", "findings", "suggested_actions", "disclaimer"],
  properties: {
    headline: { type: "string", description: "One sentence leading with gross margin and what changed. No markdown." },
    warm_line: { type: "string", description: "One warm, human sentence." },
    findings: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "evidence_metric_ids", "severity"],
        properties: {
          claim: { type: "string", description: "One or two plain sentences quoting numbers exactly as their display strings." },
          evidence_metric_ids: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } },
          severity: { type: "string", enum: ["info", "warning", "high"] },
        },
      },
    },
    suggested_actions: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "reason", "confidence"],
        properties: {
          action: { type: "string" },
          reason: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
    disclaimer: { type: "string" },
  },
} as const;

export type Severity = z.infer<typeof severitySchema>;
export type Finding = z.infer<typeof findingSchema>;
export type SuggestedAction = z.infer<typeof actionSchema>;
export type MoneyBrief = z.infer<typeof moneyBriefSchema>;

export interface Anomaly {
  id: string;
  kind: "recurring_jump" | "fee_rate_drift" | "payout_missing" | "roas_drop" | "margin_negative" | "low_runway" | "uncategorized_backlog" | "burn_up";
  severity: Severity;
  /** Deterministic sentence built only from metric display strings. */
  message: string;
  metricIds: string[];
  /** A concrete next step the rule suggests; the fallback brief uses it verbatim. */
  suggestedAction: string;
  channelId?: string;
}

/** Everything the model sees. Stored on AiInsight.inputSnapshot for replay. */
export interface BriefInput {
  organizationName: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  asOf: string;
  window: MetricsView["window"];
  prevWindow: MetricsView["prevWindow"];
  dataDays: number;
  metrics: { id: string; label: string; display: string; window: MetricsView["window"] | null; prev?: string; note?: string; channel?: string }[];
  anomalies: Anomaly[];
}

export const DISCLAIMER = "Observations from your ledger, not financial, tax, or legal advice. Every number links to the metric behind it.";
