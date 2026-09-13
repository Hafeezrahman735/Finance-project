import { addCalendarDays, todayIn, type CalendarDate } from "@ledgeriq/shared";
import bcrypt from "bcryptjs";
import type { Db } from "../db/prisma.js";
import { EntrySource, MembershipRole, SalesChannelKind } from "../generated/prisma/enums.js";
import { ensureClearingAccount, seedDefaultChart, systemAccount } from "../services/ledger/chart.js";
import { postEntryTx } from "../services/ledger/ledger.js";

/**
 * Deterministic demo organization: a small social-first product brand with
 * ~90 days of bank activity, two sales channels, batched processor payouts,
 * three recurring charges, and two planted anomalies (a subscription that
 * jumps, a payout that never arrives). Used by `npm run db:seed`, the demo
 * login, and the brief evals (plan E7 / eng review).
 *
 * Same seed ⇒ same data, so golden tests can pin exact numbers.
 */
export const DEMO_EMAIL = "demo@ledgeriq.local";
export const DEMO_PASSWORD = "demo-ledgeriq";
export const DEMO_ORG_NAME = "Sunny Side Studio";

export interface DemoSummary {
  organizationId: string;
  userId: string;
  entries: number;
  uncategorized: number;
  from: CalendarDate;
  to: CalendarDate;
}

// Mulberry32: tiny seeded PRNG, good enough for fixtures.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedDemoOrg(db: Db, opts: { today?: CalendarDate; seed?: number } = {}): Promise<DemoSummary> {
  // Development-only fixture: the re-seed path below bypasses the ledger's delete guards, which must never run against real books.
  if (process.env.NODE_ENV === "production") throw new Error("seedDemoOrg refuses to run with NODE_ENV=production");
  const random = rng(opts.seed ?? 20260912);
  const timezone = "America/Chicago";
  const today = opts.today ?? todayIn(timezone);
  const from = addCalendarDays(today, -89);

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const user = await db.user.upsert({
    where: { email: DEMO_EMAIL },
    update: { passwordHash },
    create: { email: DEMO_EMAIL, fullName: "Demo Owner", passwordHash },
  });

  const existing = await db.organization.findFirst({ where: { name: DEMO_ORG_NAME, memberships: { some: { userId: user.id } } } });
  if (existing) {
    // Re-seeding: wipe the org's books and rebuild (idempotent for `npm run db:seed`).
    // The ledger triggers forbid deleting posted entries (docs/ledger.md); this is the
    // one place that is allowed to, because the demo org is fixture data. The triggers
    // are switched off around the cascade (not inside it: the deferred balance
    // triggers leave pending events that block ALTER TABLE) and always restored.
    await db.$executeRawUnsafe('ALTER TABLE "journal_entries" DISABLE TRIGGER "journal_entries_guard_delete"');
    await db.$executeRawUnsafe('ALTER TABLE "journal_lines" DISABLE TRIGGER "journal_lines_guard_change"');
    try {
      await db.organization.delete({ where: { id: existing.id } });
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE "journal_lines" ENABLE TRIGGER "journal_lines_guard_change"');
      await db.$executeRawUnsafe('ALTER TABLE "journal_entries" ENABLE TRIGGER "journal_entries_guard_delete"');
    }
  }

  const org = await db.organization.create({
    // The demo org opts into the weekly brief so `npm run setup` shows one; real orgs opt in from Settings.
    data: { name: DEMO_ORG_NAME, timezone, featureFlags: { moneyBrief: true }, memberships: { create: { userId: user.id, role: MembershipRole.OWNER } } },
  });

  let entries = 0;
  let uncategorized = 0;

  await db.$transaction(
    async (tx) => {
      await seedDefaultChart(tx, org.id);
      const id = (key: string) => systemAccount(tx, org.id, key).then((a) => a.id);
      const cash = await id("cash");
      const unc = await id("uncategorized");
      const sales = await id("sales");
      const fees = await id("processor_fees");
      const cogs = await id("cogs");
      const ads = await id("advertising");
      const software = await id("software");
      const shipping = await id("shipping");
      const draws = await id("owner_draws");
      const opening = await id("opening_balance");
      const stripe = (await ensureClearingAccount(tx, org.id, "stripe", "Stripe")).id;
      const shopifyPay = (await ensureClearingAccount(tx, org.id, "shopify_payments", "Shopify Payments")).id;

      const shopify = await tx.salesChannel.create({ data: { organizationId: org.id, kind: SalesChannelKind.SHOPIFY, name: "Shopify", feeModel: { percent: 2.9, fixedMinor: 30 } } });
      const tiktok = await tx.salesChannel.create({ data: { organizationId: org.id, kind: SalesChannelKind.TIKTOK_SHOP, name: "TikTok Shop", feeModel: { percent: 6, fixedMinor: 0 } } });

      const post = async (date: CalendarDate, memo: string, lines: Parameters<typeof postEntryTx>[1]["lines"], source: EntrySource = EntrySource.BANK, ref?: string) => {
        await postEntryTx(tx, { organizationId: org.id, date, memo, source, externalRef: ref ?? `${source.toLowerCase()}:${entries}`, lines, actor: { userId: user.id } });
        entries++;
      };

      // Opening cash
      await post(from, "Opening balance", [{ accountId: cash, debitMinor: 1_250_000, isBankSide: true }, { accountId: opening, creditMinor: 1_250_000 }], EntrySource.OPENING, "opening");

      for (let d = 0; d < 90; d++) {
        const date = addCalendarDays(from, d);
        const dow = (d + 2) % 7; // 0 = Sunday-ish; only the pattern matters
        const week = Math.floor(d / 7);

        // Orders (accrual) per channel, posted to clearing; ~2/3 of days have Shopify orders, ~1/3 TikTok.
        if (random() < 0.66) {
          const gross = 3000 + Math.floor(random() * 22000);
          const fee = Math.round(gross * 0.029) + 30;
          const cost = Math.round(gross * 0.38);
          await post(date, `Shopify orders ${date}`, [
            { accountId: shopifyPay, debitMinor: gross - fee, channelId: shopify.id },
            { accountId: fees, debitMinor: fee, channelId: shopify.id },
            { accountId: sales, creditMinor: gross, channelId: shopify.id },
          ], EntrySource.ORDER, `shopify:${date}`);
          await post(date, `COGS Shopify ${date}`, [{ accountId: cogs, debitMinor: cost, channelId: shopify.id }, { accountId: cash, creditMinor: cost, isBankSide: true }], EntrySource.ORDER, `cogs-shopify:${date}`);
        }
        if (random() < 0.35) {
          const gross = 2000 + Math.floor(random() * 15000);
          // Planted anomaly 1: TikTok fee rate jumps from 6% to 8.1% in the last 3 weeks.
          const rate = week >= 10 ? 0.081 : 0.06;
          const fee = Math.round(gross * rate);
          const cost = Math.round(gross * 0.41);
          await post(date, `TikTok Shop orders ${date}`, [
            { accountId: stripe, debitMinor: gross - fee, channelId: tiktok.id },
            { accountId: fees, debitMinor: fee, channelId: tiktok.id },
            { accountId: sales, creditMinor: gross, channelId: tiktok.id },
          ], EntrySource.ORDER, `tiktok:${date}`);
          await post(date, `COGS TikTok ${date}`, [{ accountId: cogs, debitMinor: cost, channelId: tiktok.id }, { accountId: cash, creditMinor: cost, isBankSide: true }], EntrySource.ORDER, `cogs-tiktok:${date}`);
        }

        // Weekly batched payouts land in the bank on "Fridays" (dow 5): clear the clearing accounts.
        if (dow === 5 && d > 3) {
          for (const [clearing, label] of [[shopifyPay, "SHOPIFY PAYOUT"], [stripe, "STRIPE TRANSFER"]] as const) {
            const bal = await tx.journalLine.aggregate({ where: { organizationId: org.id, accountId: clearing }, _sum: { debitMinor: true, creditMinor: true } });
            const net = Number(bal._sum.debitMinor ?? 0n) - Number(bal._sum.creditMinor ?? 0n);
            // Planted anomaly 2: the last Stripe payout never arrives.
            if (net > 0 && !(label === "STRIPE TRANSFER" && d > 82)) {
              await post(date, label, [{ accountId: cash, debitMinor: net, isBankSide: true }, { accountId: clearing, creditMinor: net }], EntrySource.BANK, `payout:${label}:${date}`);
            }
          }
        }

        // Ad spend: daily Meta/TikTok, categorized by channel.
        if (random() < 0.8) {
          const spend = 2500 + Math.floor(random() * 6000);
          const channel = random() < 0.6 ? shopify.id : tiktok.id;
          await post(date, channel === shopify.id ? "META ADS" : "TIKTOK ADS", [{ accountId: ads, debitMinor: spend, channelId: channel }, { accountId: cash, creditMinor: spend, isBankSide: true }]);
        }

        // Recurring charges: Shopify plan (day 3), Canva (day 12; jumps from $12.99 to $29.99 on the last occurrence = anomaly-ish drift), Klaviyo (day 20).
        const dom = (d % 30) + 1;
        if (dom === 3) await post(date, "SHOPIFY PLAN", [{ accountId: software, debitMinor: 7900 }, { accountId: cash, creditMinor: 7900, isBankSide: true }]);
        if (dom === 12) await post(date, "CANVA", [{ accountId: software, debitMinor: d > 60 ? 2999 : 1299 }, { accountId: cash, creditMinor: d > 60 ? 2999 : 1299, isBankSide: true }]);
        if (dom === 20) await post(date, "KLAVIYO", [{ accountId: software, debitMinor: 4500 }, { accountId: cash, creditMinor: 4500, isBankSide: true }]);

        // Shipping labels a few times a week, still uncategorized for the most recent 2 weeks (the queue the user sees).
        if (random() < 0.4) {
          const amt = 800 + Math.floor(random() * 4000);
          const recent = d > 75;
          await post(date, "PIRATE SHIP", [{ accountId: recent ? unc : shipping, debitMinor: amt }, { accountId: cash, creditMinor: amt, isBankSide: true }]);
          if (recent) uncategorized++;
        }

        // Owner draw monthly
        if (dom === 28) await post(date, "TRANSFER TO OWNER", [{ accountId: draws, debitMinor: 150000 }, { accountId: cash, creditMinor: 150000, isBankSide: true }]);
      }
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  return { organizationId: org.id, userId: user.id, entries, uncategorized, from, to: today };
}
