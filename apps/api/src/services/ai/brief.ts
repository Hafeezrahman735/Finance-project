import { addCalendarDays, calendarToDateColumn, dateColumnToCalendar, todayIn, weekStartMonday, type CalendarDate } from "@ledgeriq/shared";
import type { Logger } from "pino";
import type { Db } from "../../db/prisma.js";
import { InsightKind, InsightStatus, MembershipRole } from "../../generated/prisma/enums.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { NotFoundError, RateLimitError } from "../../lib/errors.js";
import type { EmailSink } from "../email/email.js";
import type { MetricsService, MetricsView } from "../metrics/metrics.js";
import { detectAnomalies } from "./anomalies.js";
import { fallbackBrief } from "./fallback.js";
import { validateBrief } from "./grounding.js";
import { ModelUnavailableError, type BriefModel } from "./model.js";
import { PROMPT_VERSION, type Anomaly, type BriefInput, type MoneyBrief } from "./schema.js";

/**
 * Weekly Money Brief (plan E8; Phase 4 pulled forward, observations only).
 *
 *   metrics.get ─▶ detectAnomalies ─▶ BriefInput ─▶ model.generate ─▶ validateBrief ─┬─ ok ─▶ GENERATED
 *        │                                             ▲                 │ fail       │
 *        │                                             └── retry once ◀──┘            │
 *        │                                                  with feedback             │
 *        └─ insufficient data / model off / refused / failed twice ─▶ fallbackBrief ─▶ DEGRADED
 *
 * One insight per (org, week); the input snapshot and raw response are stored
 * so a brief can be replayed (CEO 4.1, 8.1). Regeneration is capped per week.
 */
export const REGENERATION_CAP = 3;

export interface BriefOrg {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  featureFlags?: unknown;
}

export interface BriefDTO {
  id: string;
  periodStart: CalendarDate;
  periodEnd: CalendarDate;
  asOf: CalendarDate;
  status: InsightStatus;
  model: string | null;
  degradedReason: string | null;
  brief: MoneyBrief;
  anomalies: Anomaly[];
  /** Evidence for the popovers: every metric the brief may cite. */
  metrics: Record<string, { label: string; display: string; window: MetricsView["window"] | null; prev?: string; channelId?: string; note?: string }>;
  insufficientData: boolean;
  dataDays: number;
  firstOpen: boolean;
  regenerations: number;
  createdAt: string;
}

/**
 * Off unless the organization opted in (`feature_flags.moneyBrief = true`):
 * with an Anthropic key set, the brief sends metric labels, values, and
 * merchant names to a third party, so that is an owner's decision
 * (Settings → Weekly brief), not a default.
 */
export function briefEnabled(org: BriefOrg): boolean {
  const flags = (org.featureFlags ?? {}) as Record<string, unknown>;
  return flags.moneyBrief === true;
}

export function toBriefInput(org: BriefOrg, view: MetricsView, anomalies: Anomaly[], periodStart: CalendarDate, periodEnd: CalendarDate): BriefInput {
  const channelName = new Map(view.channels.map((c) => [c.id, c.name]));
  return {
    organizationName: org.name,
    currency: org.currency,
    periodStart,
    periodEnd,
    asOf: view.asOf,
    window: view.window,
    prevWindow: view.prevWindow,
    dataDays: view.dataDays,
    metrics: view.metrics.map((m) => ({
      id: m.id,
      label: m.label,
      display: m.display,
      window: m.window,
      ...(m.prev ? { prev: m.prev.display } : {}),
      ...(m.note ? { note: m.note } : {}),
      ...(m.channelId ? { channel: channelName.get(m.channelId) ?? m.channelId } : {}),
    })),
    anomalies,
  };
}

export function briefService(db: Db, deps: { metrics: MetricsService; model: BriefModel; email: EmailSink; appUrl: string; logger?: Logger }) {
  const { metrics, model, email, logger } = deps;

  function periodFor(org: BriefOrg, now: Date): { periodStart: CalendarDate; periodEnd: CalendarDate } {
    const periodStart = weekStartMonday(todayIn(org.timezone, now));
    return { periodStart, periodEnd: addCalendarDays(periodStart, 6) };
  }

  /** Generate (or regenerate) the brief for one week. */
  async function generate(org: BriefOrg, now: Date = new Date(), opts: { regenerate?: boolean } = {}): Promise<BriefDTO> {
    const { periodStart, periodEnd } = periodFor(org, now);
    const where = { organizationId_kind_periodStart: { organizationId: org.id, kind: InsightKind.WEEKLY_BRIEF, periodStart: calendarToDateColumn(periodStart) } };
    const existing = await db.aiInsight.findUnique({ where });
    if (existing && !opts.regenerate) return toDTO(existing, false);
    if (existing && existing.regenerations >= REGENERATION_CAP) {
      throw new RateLimitError(`This week's brief was already regenerated ${REGENERATION_CAP} times; it refreshes on its own next Monday`, "brief_regeneration_limit");
    }

    const view = await metrics.get(org.id, org.currency, org.timezone, now);
    const anomalies = detectAnomalies(view);
    const input = toBriefInput(org, view, anomalies, periodStart, periodEnd);

    let brief: MoneyBrief;
    let status: InsightStatus = InsightStatus.DEGRADED;
    let modelId: string | null = null;
    let raw: string | null = null;
    let requestId: string | null = null;
    let degradedReason: string | null = null;

    if (view.insufficientData) {
      degradedReason = "insufficient_data";
      brief = fallbackBrief(view, anomalies);
    } else {
      const attempt = await narrate(input);
      if (attempt.brief) {
        brief = attempt.brief;
        status = InsightStatus.GENERATED;
      } else {
        brief = fallbackBrief(view, anomalies);
        degradedReason = attempt.reason;
        if (attempt.reason.startsWith("grounding")) logger?.error({ organizationId: org.id, reason: attempt.reason }, "brief failed grounding twice");
      }
      modelId = attempt.model ?? null;
      raw = attempt.raw ?? null;
      requestId = attempt.requestId ?? null;
    }

    const data = {
      status,
      model: modelId,
      promptVersion: PROMPT_VERSION,
      inputSnapshot: input as unknown as Prisma.InputJsonValue,
      rawResponse: raw,
      brief: brief as unknown as Prisma.InputJsonValue,
      degradedReason,
      requestId,
    };
    const row = await db.aiInsight.upsert({
      where,
      create: { organizationId: org.id, kind: InsightKind.WEEKLY_BRIEF, periodStart: calendarToDateColumn(periodStart), periodEnd: calendarToDateColumn(periodEnd), ...data },
      update: { ...data, regenerations: { increment: existing ? 1 : 0 }, firstOpenedAt: null, emailedAt: null },
    });
    logger?.info({ organizationId: org.id, periodStart, status, degradedReason, model: modelId }, "weekly brief stored");
    return toDTO(row, false);
  }

  /** model → validate → retry once with the validator's feedback. Never throws for model problems. */
  async function narrate(input: BriefInput): Promise<{ brief: MoneyBrief | null; reason: string; model?: string; raw?: string; requestId?: string }> {
    let feedback: string | undefined;
    let last: { model?: string; raw?: string; requestId?: string } = {};
    for (let attempt = 0; attempt < 2; attempt++) {
      let result;
      try {
        result = await model.generate(input, feedback);
      } catch (err) {
        if (err instanceof ModelUnavailableError) return { brief: null, reason: `model_unavailable: ${err.message}`, ...last };
        throw err;
      }
      last = { model: result.model, raw: result.raw, requestId: result.requestId };
      if (!result.brief) return { brief: null, reason: result.failure ?? "empty", ...last };
      const check = validateBrief(result.brief, input);
      if (check.ok) return { brief: result.brief, reason: "", ...last };
      feedback = check.errors.slice(0, 5).join("; ");
      logger?.warn({ attempt, errors: check.errors }, "brief failed grounding");
    }
    return { brief: null, reason: `grounding: ${feedback}`, ...last };
  }

  function toDTO(row: { id: string; periodStart: Date; periodEnd: Date; status: InsightStatus; model: string | null; degradedReason: string | null; brief: unknown; inputSnapshot: unknown; firstOpenedAt: Date | null; regenerations: number; createdAt: Date }, firstOpen: boolean): BriefDTO {
    const input = row.inputSnapshot as BriefInput;
    const metricsById: BriefDTO["metrics"] = {};
    for (const m of input.metrics) metricsById[m.id] = { label: m.label, display: m.display, window: m.window ?? null, ...(m.prev ? { prev: m.prev } : {}), ...(m.note ? { note: m.note } : {}) };
    return {
      id: row.id,
      periodStart: dateColumnToCalendar(row.periodStart),
      periodEnd: dateColumnToCalendar(row.periodEnd),
      asOf: input.asOf,
      status: row.status,
      model: row.model,
      degradedReason: row.degradedReason,
      brief: row.brief as MoneyBrief,
      anomalies: input.anomalies,
      metrics: metricsById,
      insufficientData: row.degradedReason === "insufficient_data",
      dataDays: input.dataDays,
      firstOpen,
      regenerations: row.regenerations,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Email the stored brief to owners/admins with a verified email. Re-sends, never regenerates. */
  async function emailBrief(org: BriefOrg, insightId: string): Promise<number> {
    const row = await db.aiInsight.findFirst({ where: { id: insightId, organizationId: org.id } });
    if (!row) throw new NotFoundError("Brief not found", "brief_not_found");
    const dto = toDTO(row, false);
    const recipients = await db.membership.findMany({ where: { organizationId: org.id, role: { in: [MembershipRole.OWNER, MembershipRole.ADMIN] }, user: { emailVerifiedAt: { not: null } } }, include: { user: true } });
    const text = renderBriefText(org, dto, deps.appUrl);
    let sent = 0;
    for (const r of recipients) {
      try {
        await email.send({ to: r.user.email, subject: `${org.name}: your Money Brief for the week of ${dto.periodStart}`, text });
        sent++;
      } catch (err) {
        logger?.error({ err, to: r.user.email }, "brief email failed");
      }
    }
    if (sent > 0) await db.aiInsight.update({ where: { id: row.id }, data: { emailedAt: new Date() } });
    return sent;
  }

  return {
    generate,
    briefEnabled,
    periodFor,

    /** This week's brief, generated on first request. Marks the first open unless `peek` (the Overview's one-line preview). */
    async current(org: BriefOrg, now: Date = new Date(), opts: { peek?: boolean } = {}): Promise<BriefDTO | null> {
      if (!briefEnabled(org)) return null;
      const { periodStart } = periodFor(org, now);
      let row = await db.aiInsight.findUnique({ where: { organizationId_kind_periodStart: { organizationId: org.id, kind: InsightKind.WEEKLY_BRIEF, periodStart: calendarToDateColumn(periodStart) } } });
      if (!row) {
        await generate(org, now);
        row = (await db.aiInsight.findUnique({ where: { organizationId_kind_periodStart: { organizationId: org.id, kind: InsightKind.WEEKLY_BRIEF, periodStart: calendarToDateColumn(periodStart) } } }))!;
      }
      const firstOpen = row.firstOpenedAt === null;
      if (firstOpen && !opts.peek) await db.aiInsight.update({ where: { id: row.id }, data: { firstOpenedAt: now } });
      return toDTO(row, firstOpen);
    },

    async list(organizationId: string): Promise<Pick<BriefDTO, "id" | "periodStart" | "periodEnd" | "status" | "createdAt">[]> {
      const rows = await db.aiInsight.findMany({ where: { organizationId, kind: InsightKind.WEEKLY_BRIEF }, orderBy: { periodStart: "desc" }, take: 52 });
      return rows.map((r) => ({ id: r.id, periodStart: dateColumnToCalendar(r.periodStart), periodEnd: dateColumnToCalendar(r.periodEnd), status: r.status, createdAt: r.createdAt.toISOString() }));
    },

    async get(organizationId: string, id: string): Promise<BriefDTO> {
      const row = await db.aiInsight.findFirst({ where: { id, organizationId } }).catch(() => null);
      if (!row) throw new NotFoundError("Brief not found", "brief_not_found");
      return toDTO(row, false);
    },

    emailBrief,

    /** The weekly run (scripts/weekly-brief.ts): every enabled org gets this week's brief and an email. */
    async runWeekly(now: Date = new Date()): Promise<{ organizations: number; generated: number; emailed: number }> {
      const orgs = await db.organization.findMany({ select: { id: true, name: true, currency: true, timezone: true, featureFlags: true } });
      let generated = 0;
      let emailed = 0;
      for (const org of orgs) {
        if (!briefEnabled(org)) continue;
        try {
          const dto = await generate(org, now);
          generated++;
          const row = await db.aiInsight.findUnique({ where: { id: dto.id }, select: { emailedAt: true } });
          if (!row?.emailedAt) emailed += await emailBrief(org, dto.id);
        } catch (err) {
          logger?.error({ err, organizationId: org.id }, "weekly brief failed for organization");
        }
      }
      return { organizations: orgs.length, generated, emailed };
    },
  };
}

export function renderBriefText(org: BriefOrg, dto: BriefDTO, appUrl: string): string {
  const b = dto.brief;
  const lines = [
    `${org.name}: week of ${dto.periodStart}`,
    "",
    b.headline,
    b.warm_line,
    "",
    ...b.findings.map((f) => `${f.severity === "high" ? "! " : ""}${f.claim}`),
    "",
    "Suggested next step:",
    ...b.suggested_actions.map((a) => `${a.action} (${a.reason})`),
    "",
    dto.status === "DEGRADED" ? "AI narration unavailable this week; these are the numbers as computed." : "",
    `Full brief with evidence: ${appUrl}/brief`,
    "",
    b.disclaimer,
  ];
  return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
}

export type BriefService = ReturnType<typeof briefService>;
