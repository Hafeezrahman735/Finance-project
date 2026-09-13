import { bigintToMinor, calendarToDateColumn, dateColumnToCalendar, type CalendarDate, type Minor } from "@ledgeriq/shared";
import type { Logger } from "pino";
import { z } from "zod";
import { serializable, type Db, type Tx } from "../../db/prisma.js";
import { BankConnectionStatus, BankTransactionStatus, EntrySource, EntryStatus } from "../../generated/prisma/enums.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { ConflictError, NotFoundError, UpstreamError } from "../../lib/errors.js";
import type { Secrets } from "../../lib/secrets.js";
import { postEntryTx, reverseEntryTx } from "../ledger/ledger.js";
import { systemAccount } from "../ledger/chart.js";
import type { Actor } from "../ledger/types.js";
import { matchRule, rulesService, type RuleRow } from "../rules/rules.js";
import { bankAccountsService, type BankAccountView } from "./bankAccounts.js";
import { FeedProviderError, type FeedProvider, type FeedTransaction, type SyncPage } from "./feedProvider.js";

/**
 * Bank feeds (plan 1.4b; eng review F2: sync semantics).
 *
 *   connect ──▶ exchange public token ──▶ seal access token ──▶ create BankAccounts (+ ledger accounts) ──▶ sync
 *
 *   sync:  cursor = connection.syncCursor
 *          loop ── provider.sync(cursor) ──▶ one DB transaction: apply added → modified → removed, then save nextCursor
 *                    │                                                                          │
 *                    │  MUTATION_DURING_PAGINATION → restart from the last SAVED cursor (≤ 3)    │
 *                    │  ITEM_LOGIN_REQUIRED        → status NEEDS_REAUTH, stop                    │
 *                    └──────────────────────────── while hasMore ◀──────────────────────────────┘
 *
 *   added     post a BANK entry (bank-side line + offset from a rule or Uncategorized); a posted row that
 *             replaces a pending one (pendingExternalId) inherits the pending row's category
 *   modified  reverse the live entry and re-post with the same category (bank-side lines never change in place)
 *   removed   reverse the live entry; the row stays as REMOVED for the audit trail
 *
 * Re-running a sync from any cursor is idempotent: rows are keyed by the provider's transaction id.
 */
export const connectSchema = z.object({
  publicToken: z.string().min(1).max(500),
  institutionName: z.string().trim().min(1).max(120).optional(),
  institutionId: z.string().trim().max(80).optional(),
});

export const MAX_RESTARTS = 3;

export interface ConnectionView {
  id: string;
  provider: string;
  institutionName: string;
  status: BankConnectionStatus;
  lastSyncedAt: string | null;
  lastError: string | null;
  accounts: BankAccountView[];
  transactionCount: number;
  createdAt: string;
}

export interface SyncResult {
  connectionId: string;
  status: BankConnectionStatus;
  pages: number;
  added: number;
  modified: number;
  removed: number;
  skipped: number;
  restarts: number;
}

type ConnectionRow = Prisma.BankConnectionGetPayload<{ include: { accounts: true } }>;

export function feedsService(db: Db, deps: { provider: FeedProvider; secrets: Secrets; logger?: Logger }) {
  const { provider, secrets, logger } = deps;
  const bankAccounts = bankAccountsService(db);
  const rules = rulesService(db);
  const inFlight = new Map<string, Promise<SyncResult>>();

  async function load(organizationId: string, id: string): Promise<ConnectionRow> {
    const row = await db.bankConnection.findFirst({ where: { id, organizationId }, include: { accounts: true } }).catch(() => null);
    if (!row) throw new NotFoundError("Bank connection not found", "bank_connection_not_found");
    return row;
  }

  /** Decrypt the access token, re-sealing the row if it was written under a previous key. */
  async function accessTokenOf(conn: ConnectionRow): Promise<string> {
    const sealed = { ciphertext: conn.accessTokenCiphertext, keyId: conn.keyId };
    const token = secrets.open(sealed);
    if (secrets.needsRotation(sealed)) {
      const resealed = secrets.seal(token);
      await db.bankConnection.update({ where: { id: conn.id }, data: { accessTokenCiphertext: resealed.ciphertext, keyId: resealed.keyId } });
      logger?.info({ connectionId: conn.id, from: sealed.keyId, to: resealed.keyId }, "bank access token re-encrypted under the current key");
    }
    return token;
  }

  async function toView(conn: ConnectionRow): Promise<ConnectionView> {
    const transactionCount = await db.bankTransaction.count({ where: { connectionId: conn.id, status: BankTransactionStatus.ACTIVE } });
    return {
      id: conn.id,
      provider: conn.provider,
      institutionName: conn.institutionName,
      status: conn.status,
      lastSyncedAt: conn.lastSyncedAt?.toISOString() ?? null,
      lastError: conn.lastError,
      accounts: conn.accounts.filter((a) => !a.isArchived).map((a) => ({ id: a.id, name: a.name, kind: a.kind, accountId: a.accountId, currency: a.currency, mask: a.mask })),
      transactionCount,
      createdAt: conn.createdAt.toISOString(),
    };
  }

  function mapError(err: unknown): never {
    if (err instanceof FeedProviderError) throw new UpstreamError(`The bank feed provider returned an error: ${err.message}`, `feed_${err.code.toLowerCase()}`);
    throw err;
  }

  // ---------------------------------------------------------------------------
  // Applying a page
  // ---------------------------------------------------------------------------

  interface PageContext {
    conn: ConnectionRow;
    accountsByExternalId: Map<string, { id: string; accountId: string; currency: string }>;
    rules: RuleRow[];
    uncategorizedId: string;
    actor: Actor;
    counters: { added: number; modified: number; removed: number; skipped: number };
  }

  /** The offset line (the non-bank side) of a live entry: what category it carries. */
  async function offsetOf(tx: Tx, entryId: string): Promise<{ accountId: string; channelId: string | null } | null> {
    const entry = await tx.journalEntry.findUnique({ where: { id: entryId }, select: { status: true, lines: { where: { isBankSide: false }, select: { accountId: true, channelId: true }, take: 1 } } });
    if (!entry || entry.status !== EntryStatus.POSTED || entry.lines.length === 0) return null;
    return entry.lines[0]!;
  }

  async function post(tx: Tx, ctx: PageContext, t: FeedTransaction, bank: { accountId: string }, offset: { accountId: string; channelId: string | null }, revision: number) {
    const abs = Math.abs(t.amountMinor);
    const lines =
      t.amountMinor > 0
        ? [{ accountId: bank.accountId, debitMinor: abs, isBankSide: true }, { accountId: offset.accountId, creditMinor: abs, channelId: offset.channelId }]
        : [{ accountId: bank.accountId, creditMinor: abs, isBankSide: true }, { accountId: offset.accountId, debitMinor: abs, channelId: offset.channelId }];
    return postEntryTx(tx, {
      organizationId: ctx.conn.organizationId,
      date: t.date,
      memo: t.description,
      source: EntrySource.BANK,
      externalRef: `${ctx.conn.provider}:${t.externalId}:${revision}`,
      lines,
      actor: ctx.actor,
    });
  }

  async function applyAdded(tx: Tx, ctx: PageContext, t: FeedTransaction): Promise<void> {
    if (t.amountMinor === 0) return;
    const existing = await tx.bankTransaction.findUnique({ where: { connectionId_externalId: { connectionId: ctx.conn.id, externalId: t.externalId } } });
    if (existing) return applyModified(tx, ctx, t, existing);
    const bank = ctx.accountsByExternalId.get(t.accountExternalId);
    if (!bank) {
      ctx.counters.skipped++;
      logger?.warn({ connectionId: ctx.conn.id, account: t.accountExternalId }, "feed row for an unknown account skipped");
      return;
    }
    // A posted row replacing a pending one keeps the category the user (or a rule) already gave it.
    let offset: { accountId: string; channelId: string | null } | null = null;
    if (t.pendingExternalId) {
      const pending = await tx.bankTransaction.findUnique({ where: { connectionId_externalId: { connectionId: ctx.conn.id, externalId: t.pendingExternalId } }, select: { entryId: true } });
      if (pending?.entryId) offset = await offsetOf(tx, pending.entryId);
    }
    if (!offset) {
      const rule = matchRule(t.description, ctx.rules);
      offset = rule ? { accountId: rule.accountId, channelId: rule.channelId } : { accountId: ctx.uncategorizedId, channelId: null };
      if (rule) await tx.categoryRule.update({ where: { id: rule.id }, data: { hitCount: { increment: 1 } } });
    }
    const entry = await post(tx, ctx, t, bank, offset, 0);
    await tx.bankTransaction.create({
      data: {
        organizationId: ctx.conn.organizationId,
        connectionId: ctx.conn.id,
        bankAccountId: bank.id,
        externalId: t.externalId,
        pendingExternalId: t.pendingExternalId,
        date: calendarToDateColumn(t.date),
        amountMinor: t.amountMinor,
        description: t.description,
        pending: t.pending,
        entryId: entry.id,
        raw: t.raw as Prisma.InputJsonValue,
      },
    });
    ctx.counters.added++;
  }

  async function applyModified(tx: Tx, ctx: PageContext, t: FeedTransaction, existing?: { id: string; entryId: string | null; revision: number; bankAccountId: string; status: BankTransactionStatus } | null): Promise<void> {
    const row = existing ?? (await tx.bankTransaction.findUnique({ where: { connectionId_externalId: { connectionId: ctx.conn.id, externalId: t.externalId } } }));
    if (!row) return applyAdded(tx, ctx, t);
    if (row.status === BankTransactionStatus.REMOVED) return; // the provider revived a removed id: ignore
    const bank = [...ctx.accountsByExternalId.values()].find((b) => b.id === row.bankAccountId);
    if (!bank) {
      ctx.counters.skipped++;
      return;
    }
    // Unchanged (an idempotent re-sync of an earlier page): nothing to do.
    const current = await tx.bankTransaction.findUnique({ where: { id: row.id }, select: { amountMinor: true, date: true, description: true, pending: true } });
    if (current && bigintToMinor(current.amountMinor) === t.amountMinor && dateColumnToCalendar(current.date) === t.date && current.description === t.description && current.pending === t.pending) return;

    let offset = row.entryId ? await offsetOf(tx, row.entryId) : null;
    if (row.entryId) {
      const live = await tx.journalEntry.findUnique({ where: { id: row.entryId }, select: { status: true } });
      if (live?.status === EntryStatus.POSTED) await reverseEntryTx(tx, { organizationId: ctx.conn.organizationId, entryId: row.entryId, memo: `Bank updated: ${t.description}`, actor: ctx.actor });
    }
    if (!offset) {
      const rule = matchRule(t.description, ctx.rules);
      offset = rule ? { accountId: rule.accountId, channelId: rule.channelId } : { accountId: ctx.uncategorizedId, channelId: null };
    }
    const revision = row.revision + 1;
    const entry = t.amountMinor === 0 ? null : await post(tx, ctx, t, bank, offset, revision);
    await tx.bankTransaction.update({
      where: { id: row.id },
      data: { date: calendarToDateColumn(t.date), amountMinor: t.amountMinor, description: t.description, pending: t.pending, pendingExternalId: t.pendingExternalId, entryId: entry?.id ?? null, revision, raw: t.raw as Prisma.InputJsonValue },
    });
    ctx.counters.modified++;
  }

  async function applyRemoved(tx: Tx, ctx: PageContext, externalId: string): Promise<void> {
    const row = await tx.bankTransaction.findUnique({ where: { connectionId_externalId: { connectionId: ctx.conn.id, externalId } } });
    if (!row || row.status === BankTransactionStatus.REMOVED) return;
    if (row.entryId) {
      const live = await tx.journalEntry.findUnique({ where: { id: row.entryId }, select: { status: true } });
      if (live?.status === EntryStatus.POSTED) await reverseEntryTx(tx, { organizationId: ctx.conn.organizationId, entryId: row.entryId, memo: `Bank removed: ${row.description}`, actor: ctx.actor });
    }
    await tx.bankTransaction.update({ where: { id: row.id }, data: { status: BankTransactionStatus.REMOVED, entryId: null, raw: { ...(row.raw as object), removedEntryId: row.entryId } as Prisma.InputJsonValue } });
    ctx.counters.removed++;
  }

  async function applyPage(tx: Tx, ctx: PageContext, page: SyncPage): Promise<void> {
    for (const t of page.added) await applyAdded(tx, ctx, t);
    for (const t of page.modified) await applyModified(tx, ctx, t);
    for (const r of page.removed) await applyRemoved(tx, ctx, r.externalId);
    await tx.bankConnection.update({ where: { id: ctx.conn.id }, data: { syncCursor: page.nextCursor, lastSyncedAt: new Date(), lastError: null } });
  }

  // ---------------------------------------------------------------------------
  // The loop
  // ---------------------------------------------------------------------------

  async function runSync(organizationId: string, connectionId: string, actor: Actor): Promise<SyncResult> {
    let conn = await load(organizationId, connectionId);
    if (conn.status === BankConnectionStatus.DISCONNECTED) throw new ConflictError("This bank was disconnected", "bank_connection_disconnected");
    const accessToken = await accessTokenOf(conn);
    const [activeRules, uncategorized] = await Promise.all([rules.activeRules(db, organizationId), systemAccount(db, organizationId, "uncategorized")]);
    const ctx: PageContext = {
      conn,
      accountsByExternalId: new Map(conn.accounts.filter((a) => a.externalId).map((a) => [a.externalId!, { id: a.id, accountId: a.accountId, currency: a.currency }])),
      rules: activeRules,
      uncategorizedId: uncategorized.id,
      actor,
      counters: { added: 0, modified: 0, removed: 0, skipped: 0 },
    };
    let cursor = conn.syncCursor;
    let pages = 0;
    let restarts = 0;
    for (;;) {
      let page: SyncPage;
      try {
        page = await provider.sync(accessToken, cursor);
      } catch (err) {
        if (err instanceof FeedProviderError) {
          if (err.code === "MUTATION_DURING_PAGINATION" && restarts < MAX_RESTARTS) {
            restarts++;
            conn = await load(organizationId, connectionId);
            cursor = conn.syncCursor; // the last committed page
            logger?.warn({ connectionId, restarts }, "feed mutated during pagination; restarting from the saved cursor");
            continue;
          }
          if (err.code === "ITEM_LOGIN_REQUIRED") {
            await db.bankConnection.update({ where: { id: connectionId }, data: { status: BankConnectionStatus.NEEDS_REAUTH, lastError: err.message } });
            return { connectionId, status: BankConnectionStatus.NEEDS_REAUTH, pages, restarts, ...ctx.counters };
          }
          await db.bankConnection.update({ where: { id: connectionId }, data: { lastError: `${err.code}: ${err.message}`.slice(0, 500) } });
          mapError(err);
        }
        throw err;
      }
      await serializable(db, (tx) => applyPage(tx, ctx, page));
      cursor = page.nextCursor;
      pages++;
      if (!page.hasMore) break;
    }
    const status = (await db.bankConnection.findUniqueOrThrow({ where: { id: connectionId }, select: { status: true } })).status;
    logger?.info({ connectionId, pages, restarts, ...ctx.counters }, "bank feed synced");
    return { connectionId, status, pages, restarts, ...ctx.counters };
  }

  /** "Sync now". Concurrent calls for one connection share the in-flight run. */
  function sync(organizationId: string, connectionId: string, actor: Actor): Promise<SyncResult> {
    const key = `${organizationId}:${connectionId}`;
    const running = inFlight.get(key);
    if (running) return running;
    const p = runSync(organizationId, connectionId, actor).finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  }

  return {
    provider: { name: provider.name, env: provider.env },
    sync,

    async linkToken(organizationId: string, userId: string, connectionId?: string): Promise<{ linkToken: string; provider: string; env: string; updateMode: boolean }> {
      let accessToken: string | undefined;
      if (connectionId) accessToken = await accessTokenOf(await load(organizationId, connectionId));
      try {
        return { linkToken: await provider.createLinkToken({ userId, accessToken }), provider: provider.name, env: provider.env, updateMode: !!connectionId };
      } catch (err) {
        return mapError(err);
      }
    },

    /** Exchange the public token from Link, store the sealed access token, create the accounts, run the first sync. */
    async connect(organizationId: string, currency: string, input: z.infer<typeof connectSchema>, actor: Actor): Promise<{ connection: ConnectionView; sync: SyncResult }> {
      let exchanged;
      let feedAccounts;
      try {
        exchanged = await provider.exchangePublicToken(input.publicToken);
        feedAccounts = await provider.listAccounts(exchanged.accessToken);
      } catch (err) {
        return mapError(err);
      }
      const institutionName = input.institutionName ?? exchanged.institutionName ?? "Bank";
      const sealed = secrets.seal(exchanged.accessToken);
      const existing = await db.bankConnection.findUnique({ where: { provider_providerItemId: { provider: provider.name, providerItemId: exchanged.itemId } } });
      if (existing && existing.organizationId !== organizationId) throw new ConflictError("This bank login is already connected to another organization", "bank_connection_exists");

      const conn = existing
        ? await db.bankConnection.update({ where: { id: existing.id }, data: { accessTokenCiphertext: sealed.ciphertext, keyId: sealed.keyId, status: BankConnectionStatus.ACTIVE, lastError: null, institutionName } })
        : await db.bankConnection.create({
            data: { organizationId, provider: provider.name, providerItemId: exchanged.itemId, institutionId: input.institutionId ?? exchanged.institutionId, institutionName, accessTokenCiphertext: sealed.ciphertext, keyId: sealed.keyId },
          });

      // One BankAccount (with its own ledger account) per feed account; names must be unique per org.
      const taken = new Set((await db.bankAccount.findMany({ where: { organizationId }, select: { name: true } })).map((b) => b.name));
      for (const fa of feedAccounts) {
        const already = await db.bankAccount.findUnique({ where: { connectionId_externalId: { connectionId: conn.id, externalId: fa.externalId } } });
        if (already) continue;
        // The mask lives in its own column; it joins the name only to keep two same-named accounts apart.
        let name = `${institutionName} ${fa.name}`.slice(0, 80);
        if (taken.has(name) && fa.mask) name = `${name.slice(0, 72)} ••${fa.mask}`;
        for (let n = 2; taken.has(name); n++) name = `${name.slice(0, 76)} (${n})`;
        taken.add(name);
        const created = await bankAccounts.create(organizationId, currency, { name, kind: fa.kind, ...(fa.mask ? { mask: fa.mask } : {}) }, actor.userId ?? null);
        await db.bankAccount.update({ where: { id: created.id }, data: { connectionId: conn.id, externalId: fa.externalId } });
      }
      await db.auditLog.create({ data: { organizationId, actorUserId: actor.userId ?? null, requestId: actor.requestId ?? null, action: "bank_connection.connect", entityType: "BankConnection", entityId: conn.id, after: { provider: provider.name, institutionName, accounts: feedAccounts.length } } });

      const result = await sync(organizationId, conn.id, actor);
      return { connection: await toView(await load(organizationId, conn.id)), sync: result };
    },

    async list(organizationId: string): Promise<ConnectionView[]> {
      const rows = await db.bankConnection.findMany({ where: { organizationId, status: { not: BankConnectionStatus.DISCONNECTED } }, include: { accounts: true }, orderBy: { createdAt: "asc" } });
      return Promise.all(rows.map(toView));
    },

    async get(organizationId: string, id: string): Promise<ConnectionView> {
      return toView(await load(organizationId, id));
    },

    /** After Link update mode succeeds: back to ACTIVE and catch up. */
    async reconnected(organizationId: string, connectionId: string, actor: Actor): Promise<SyncResult> {
      const conn = await load(organizationId, connectionId);
      if (conn.status === BankConnectionStatus.DISCONNECTED) throw new ConflictError("This bank was disconnected", "bank_connection_disconnected");
      await db.bankConnection.update({ where: { id: conn.id }, data: { status: BankConnectionStatus.ACTIVE, lastError: null } });
      return sync(organizationId, connectionId, actor);
    },

    /** Stop syncing. Entries already posted stay; the accounts stay (they hold history). */
    async disconnect(organizationId: string, connectionId: string, actor: Actor): Promise<void> {
      const conn = await load(organizationId, connectionId);
      if (conn.status === BankConnectionStatus.DISCONNECTED) return;
      try {
        await provider.remove(await accessTokenOf(conn));
      } catch (err) {
        logger?.warn({ err, connectionId }, "provider item removal failed; disconnecting locally anyway");
      }
      await db.bankConnection.update({ where: { id: conn.id }, data: { status: BankConnectionStatus.DISCONNECTED, accessTokenCiphertext: "", lastError: null } });
      await db.auditLog.create({ data: { organizationId, actorUserId: actor.userId ?? null, requestId: actor.requestId ?? null, action: "bank_connection.disconnect", entityType: "BankConnection", entityId: conn.id } });
    },
  };
}

export type FeedsService = ReturnType<typeof feedsService>;
export type { CalendarDate, Minor };
