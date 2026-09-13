import "dotenv/config";
import pino from "pino";
import { loadConfig } from "../src/config.js";
import { createPrisma } from "../src/db/prisma.js";
import { briefService } from "../src/services/ai/brief.js";
import { createBriefModel } from "../src/services/ai/model.js";
import { createEmailSink } from "../src/services/email/email.js";
import { metricsService } from "../src/services/metrics/metrics.js";

/**
 * The weekly run: `npm run brief:weekly` (Monday morning, from cron or a
 * scheduler). Generates this week's brief for every organization with the
 * moneyBrief flag on and emails it to verified owners/admins. Idempotent:
 * an existing brief is not regenerated and an emailed one is not re-sent.
 * pg-boss scheduling replaces the cron entry when the worker lands (TODOS).
 */
const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL });
const db = createPrisma(config.DATABASE_URL);
const briefs = briefService(db, { metrics: metricsService(db), model: createBriefModel(config, logger), email: createEmailSink(config, logger), appUrl: config.APP_URL, logger });

const summary = await briefs.runWeekly();
logger.info(summary, "weekly brief run finished");
await db.$disconnect();
