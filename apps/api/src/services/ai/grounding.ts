import type { BriefInput, MoneyBrief } from "./schema.js";

/**
 * Grounding validator (eng review F8/F14, CEO 3.2). A brief passes only if:
 *   1. every finding cites metric ids that exist in the input;
 *   2. every number in the text equals one of the input display values
 *      (exactly, rounded to the unit, or within 5% when written as 1.2K/2M);
 *      derived figures (differences, made-up percentages) are rejected;
 *   3. nothing contains a URL or markdown (links come only from metric ids,
 *      so injected memo text cannot steer a reader anywhere).
 *
 * Numbers are compared as values, not strings, so "$8,713" and "$8,713.29"
 * both ground to the cash_on_hand metric while "$8,700" does not.
 */
export interface GroundingResult {
  ok: boolean;
  errors: string[];
}

const NUMBER_RE = /\$?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM]\b|%|x\b)?/g;
const DATE_RE = /\b\d{4}-\d{2}-\d{2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi;
const URL_RE = /https?:\/\/|www\./i;
const MARKDOWN_RE = /\*\*|__|`|\]\(|^\s*#|<\/?[a-z][^>]*>/im;

/** Parse "$1,234.50", "57.0%", "3.2x", "1.2K", "2M" to a number and a flag for approximate suffixes. */
export function parseNumberToken(token: string): { value: number; approximate: boolean; integer: boolean } | null {
  const t = token.replace(/[$,\s]/g, "");
  const m = /^(\d+(?:\.\d+)?)([kKmM]|%|x)?$/.exec(t);
  if (!m) return null;
  let value = Number(m[1]);
  const suffix = m[2]?.toLowerCase();
  let approximate = false;
  if (suffix === "k") {
    value *= 1000;
    approximate = true;
  } else if (suffix === "m") {
    value *= 1_000_000;
    approximate = true;
  }
  return { value, approximate, integer: !m[1]!.includes(".") && !approximate };
}

/** Every value a display string can stand for: "$1,234.50" → 1234.5; "57.0%" → 57; "170 days" → 170. */
export function displayValues(display: string): number[] {
  const out: number[] = [];
  for (const tok of display.match(NUMBER_RE) ?? []) {
    const p = parseNumberToken(tok);
    if (p) out.push(p.value);
  }
  return out;
}

function matches(token: { value: number; approximate: boolean; integer: boolean }, allowed: number): boolean {
  if (Math.abs(token.value - allowed) < 0.005) return true;
  if (token.integer && Math.abs(token.value - allowed) < 0.5) return true; // "$8,713" for $8,713.29
  if (token.approximate && allowed !== 0 && Math.abs(token.value - allowed) / Math.abs(allowed) <= 0.05) return true; // "$8.7K"
  return false;
}

export function validateBrief(brief: MoneyBrief, input: BriefInput): GroundingResult {
  const errors: string[] = [];
  const ids = new Set(input.metrics.map((m) => m.id));
  const allowed = new Set<number>();
  for (const m of input.metrics) {
    for (const v of displayValues(m.display)) allowed.add(v);
    if (m.prev) for (const v of displayValues(m.prev)) allowed.add(v);
    if (m.note) for (const v of displayValues(m.note)) allowed.add(v);
  }
  for (const a of input.anomalies) for (const v of displayValues(a.message)) allowed.add(v);
  // Window lengths and the data-day count are fair to mention.
  for (const v of [7, 30, 90, input.dataDays]) allowed.add(v);
  const allowedList = [...allowed];

  const texts: [string, string][] = [
    ["headline", brief.headline],
    ["warm_line", brief.warm_line],
    ...brief.findings.map((f, i): [string, string] => [`findings[${i}].claim`, f.claim]),
    ...brief.suggested_actions.flatMap((a, i): [string, string][] => [
      [`suggested_actions[${i}].action`, a.action],
      [`suggested_actions[${i}].reason`, a.reason],
    ]),
    ["disclaimer", brief.disclaimer],
  ];

  for (const [where, text] of texts) {
    if (URL_RE.test(text)) errors.push(`${where}: contains a link`);
    if (MARKDOWN_RE.test(text)) errors.push(`${where}: contains markdown or HTML`);
    const stripped = text.replace(DATE_RE, " ");
    for (const tok of stripped.match(NUMBER_RE) ?? []) {
      const parsed = parseNumberToken(tok);
      if (!parsed) continue;
      if (!allowedList.some((a) => matches(parsed, a))) errors.push(`${where}: "${tok.trim()}" is not a number from the input`);
    }
  }

  brief.findings.forEach((f, i) => {
    for (const id of f.evidence_metric_ids) if (!ids.has(id)) errors.push(`findings[${i}]: unknown metric id "${id}"`);
  });

  return { ok: errors.length === 0, errors };
}
