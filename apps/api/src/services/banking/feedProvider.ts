import { addCalendarDays, floatToMinor, todayIn, type CalendarDate, type Minor } from "@ledgeriq/shared";
import { Configuration, CountryCode, PlaidApi, PlaidEnvironments, Products, type Transaction } from "plaid";
import type { Config } from "../../config.js";
import { BankAccountKind } from "../../generated/prisma/enums.js";

/**
 * The bank-feed seam (plan 1.4b; DX decision #75 "PLAID_ENV=fixture").
 *
 *   FeedProvider ──▶ PlaidProvider    real Plaid (sandbox or production) via the official SDK
 *                └─▶ FixtureProvider  an offline, deterministic bank used with no vendor keys and in tests
 *
 * Amounts are normalized to the bank's perspective: positive = money in,
 * negative = money out (Plaid reports the opposite sign).
 */
export interface FeedAccount {
  externalId: string;
  name: string;
  mask: string | null;
  kind: BankAccountKind;
}

export interface FeedTransaction {
  externalId: string;
  accountExternalId: string;
  date: CalendarDate;
  /** Signed minor units: + in, − out. */
  amountMinor: Minor;
  description: string;
  pending: boolean;
  /** For a posted transaction, the id of the pending one it replaces. */
  pendingExternalId: string | null;
  raw: unknown;
}

export interface SyncPage {
  added: FeedTransaction[];
  modified: FeedTransaction[];
  removed: { externalId: string }[];
  nextCursor: string;
  hasMore: boolean;
}

export type FeedErrorCode = "ITEM_LOGIN_REQUIRED" | "MUTATION_DURING_PAGINATION" | "RATE_LIMIT" | "INVALID_TOKEN" | "OTHER";

export class FeedProviderError extends Error {
  constructor(
    public readonly code: FeedErrorCode,
    message: string,
    public readonly transient = false,
  ) {
    super(message);
    this.name = "FeedProviderError";
  }
}

export interface ExchangeResult {
  accessToken: string;
  itemId: string;
  institutionId: string | null;
  institutionName: string | null;
}

export interface FeedProvider {
  readonly name: "plaid" | "fixture";
  readonly env: string;
  /** A Link token; with `accessToken` it opens Link in update mode (re-authentication). */
  createLinkToken(opts: { userId: string; accessToken?: string }): Promise<string>;
  exchangePublicToken(publicToken: string): Promise<ExchangeResult>;
  listAccounts(accessToken: string): Promise<FeedAccount[]>;
  /** One page of /transactions/sync. The caller commits the page, then persists `nextCursor`. */
  sync(accessToken: string, cursor: string | null): Promise<SyncPage>;
  remove(accessToken: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Plaid
// ---------------------------------------------------------------------------

export function plaidKind(type: string | null | undefined, subtype: string | null | undefined): BankAccountKind {
  if (type === "credit") return BankAccountKind.CREDIT_CARD;
  if (type === "depository") return subtype === "savings" || subtype === "money market" || subtype === "cd" ? BankAccountKind.SAVINGS : BankAccountKind.CHECKING;
  return BankAccountKind.OTHER;
}

export function fromPlaidTransaction(t: Transaction): FeedTransaction {
  return {
    externalId: t.transaction_id,
    accountExternalId: t.account_id,
    date: t.date,
    amountMinor: -floatToMinor(t.amount, t.iso_currency_code ?? "USD"),
    description: t.merchant_name || t.name || "Bank transaction",
    pending: t.pending,
    pendingExternalId: t.pending_transaction_id ?? null,
    raw: t,
  };
}

function plaidError(err: unknown): FeedProviderError {
  const data = (err as { response?: { data?: { error_code?: string; error_message?: string } } }).response?.data;
  const code = data?.error_code ?? "";
  const message = data?.error_message ?? (err instanceof Error ? err.message : String(err));
  if (code === "ITEM_LOGIN_REQUIRED" || code === "PENDING_EXPIRATION") return new FeedProviderError("ITEM_LOGIN_REQUIRED", message);
  if (code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION") return new FeedProviderError("MUTATION_DURING_PAGINATION", message, true);
  if (code === "RATE_LIMIT_EXCEEDED" || code === "TRANSACTIONS_LIMIT") return new FeedProviderError("RATE_LIMIT", message, true);
  if (code === "INVALID_ACCESS_TOKEN" || code === "INVALID_PUBLIC_TOKEN" || code === "ITEM_NOT_FOUND") return new FeedProviderError("INVALID_TOKEN", message);
  const status = (err as { response?: { status?: number } }).response?.status;
  return new FeedProviderError("OTHER", code ? `${code}: ${message}` : message, status !== undefined && status >= 500);
}

export class PlaidProvider implements FeedProvider {
  readonly name = "plaid" as const;
  private readonly client: PlaidApi;

  constructor(
    clientId: string,
    secret: string,
    readonly env: "sandbox" | "production",
    private readonly appName = "LedgerIQ",
  ) {
    this.client = new PlaidApi(new Configuration({ basePath: PlaidEnvironments[env], baseOptions: { headers: { "PLAID-CLIENT-ID": clientId, "PLAID-SECRET": secret } } }));
  }

  async createLinkToken(opts: { userId: string; accessToken?: string }): Promise<string> {
    try {
      const res = await this.client.linkTokenCreate({
        user: { client_user_id: opts.userId },
        client_name: this.appName,
        language: "en",
        country_codes: [CountryCode.Us],
        ...(opts.accessToken ? { access_token: opts.accessToken } : { products: [Products.Transactions] }),
      });
      return res.data.link_token;
    } catch (err) {
      throw plaidError(err);
    }
  }

  async exchangePublicToken(publicToken: string): Promise<ExchangeResult> {
    try {
      const res = await this.client.itemPublicTokenExchange({ public_token: publicToken });
      return { accessToken: res.data.access_token, itemId: res.data.item_id, institutionId: null, institutionName: null };
    } catch (err) {
      throw plaidError(err);
    }
  }

  async listAccounts(accessToken: string): Promise<FeedAccount[]> {
    try {
      const res = await this.client.accountsGet({ access_token: accessToken });
      return res.data.accounts.map((a) => ({ externalId: a.account_id, name: a.official_name || a.name, mask: a.mask ?? null, kind: plaidKind(a.type, a.subtype) }));
    } catch (err) {
      throw plaidError(err);
    }
  }

  async sync(accessToken: string, cursor: string | null): Promise<SyncPage> {
    try {
      const res = await this.client.transactionsSync({ access_token: accessToken, ...(cursor ? { cursor } : {}), count: 500 });
      const d = res.data;
      return {
        added: d.added.map(fromPlaidTransaction),
        modified: d.modified.map(fromPlaidTransaction),
        removed: d.removed.map((r) => ({ externalId: r.transaction_id })),
        nextCursor: d.next_cursor,
        hasMore: d.has_more,
      };
    } catch (err) {
      throw plaidError(err);
    }
  }

  async remove(accessToken: string): Promise<void> {
    try {
      await this.client.itemRemove({ access_token: accessToken });
    } catch (err) {
      throw plaidError(err);
    }
  }
}

// ---------------------------------------------------------------------------
// Fixture bank (offline)
// ---------------------------------------------------------------------------

/** One step of a scripted sync: a page, or an error the provider raises at that point. */
export type FixtureStep = SyncPage | { error: FeedErrorCode; message?: string };

export interface FixtureItem {
  institutionName: string;
  accounts: FeedAccount[];
  /** Pages in order; the cursor is the index of the next page. Steps past the end are empty pages. */
  steps: FixtureStep[];
}

export const FIXTURE_PUBLIC_TOKEN = "fixture-public-token";
export const FIXTURE_LINK_TOKEN = "fixture-link-token";

/**
 * A deterministic bank that needs no vendor account. Sync #1 pages through
 * 60 days of history (two pages, one pending row); sync #2 posts the pending
 * row under a new id and modifies one amount; later syncs are empty. Enough
 * to exercise every branch of the sync loop from the UI.
 */
export function defaultFixtureItem(today: CalendarDate = todayIn("America/Chicago")): FixtureItem {
  const checking = "fixture-checking";
  const card = "fixture-card";
  const tx = (id: string, account: string, daysAgo: number, amountMinor: Minor, description: string, extra: Partial<FeedTransaction> = {}): FeedTransaction => ({
    externalId: id,
    accountExternalId: account,
    date: addCalendarDays(today, -daysAgo),
    amountMinor,
    description,
    pending: false,
    pendingExternalId: null,
    raw: { fixture: true },
    ...extra,
  });
  const history: FeedTransaction[] = [];
  for (let w = 8; w >= 1; w--) {
    history.push(tx(`fx-stripe-${w}`, checking, w * 7 + 1, 48_250 + w * 1_100, "STRIPE TRANSFER"));
    history.push(tx(`fx-shopify-${w}`, checking, w * 7 + 2, 91_400 + w * 900, "SHOPIFY PAYOUT"));
    history.push(tx(`fx-meta-${w}`, card, w * 7 + 3, -(6_500 + w * 300), "META ADS"));
    history.push(tx(`fx-ship-${w}`, checking, w * 7 + 4, -(2_180 + w * 40), "PIRATE SHIP"));
    if (w % 4 === 0) history.push(tx(`fx-canva-${w}`, card, w * 7 + 5, w === 4 ? -2_999 : -1_299, "CANVA"));
    if (w % 4 === 2) history.push(tx(`fx-klaviyo-${w}`, card, w * 7 + 5, -4_500, "KLAVIYO"));
  }
  history.push(tx("fx-coffee-1", checking, 3, -1_275, "BLUE BOTTLE COFFEE"));
  history.push(tx("fx-amazon-pending", checking, 1, -8_899, "AMAZON", { pending: true }));
  const page1 = history.slice(0, 20);
  const page2 = history.slice(20);
  return {
    institutionName: "Fixture Bank",
    accounts: [
      { externalId: checking, name: "Fixture Checking", mask: "0001", kind: BankAccountKind.CHECKING },
      { externalId: card, name: "Fixture Rewards Card", mask: "4242", kind: BankAccountKind.CREDIT_CARD },
    ],
    steps: [
      { added: page1, modified: [], removed: [], nextCursor: "1", hasMore: true },
      { added: page2, modified: [], removed: [], nextCursor: "2", hasMore: false },
      {
        added: [tx("fx-amazon-posted", checking, 1, -8_899, "AMAZON", { pendingExternalId: "fx-amazon-pending" })],
        modified: [tx("fx-coffee-1", checking, 3, -1_425, "BLUE BOTTLE COFFEE")],
        removed: [{ externalId: "fx-amazon-pending" }],
        nextCursor: "3",
        hasMore: false,
      },
    ],
  };
}

export class FixtureProvider implements FeedProvider {
  readonly name = "fixture" as const;
  readonly env = "fixture";
  private readonly items = new Map<string, FixtureItem>();
  private counter = 0;

  constructor(private readonly itemFactory: () => FixtureItem = () => defaultFixtureItem()) {}

  /** Tests register a scripted item and get its public token. */
  register(item: FixtureItem): string {
    const token = `${FIXTURE_PUBLIC_TOKEN}-${++this.counter}`;
    this.items.set(token, item);
    return token;
  }

  async createLinkToken(): Promise<string> {
    return FIXTURE_LINK_TOKEN;
  }

  async exchangePublicToken(publicToken: string): Promise<ExchangeResult> {
    let item = this.items.get(publicToken);
    if (!item) {
      if (publicToken !== FIXTURE_PUBLIC_TOKEN) throw new FeedProviderError("INVALID_TOKEN", "Unknown fixture public token");
      item = this.itemFactory();
    }
    const accessToken = `fixture-access-${++this.counter}`;
    this.items.set(accessToken, item);
    return { accessToken, itemId: `fixture-item-${this.counter}`, institutionId: "ins_fixture", institutionName: item.institutionName };
  }

  private item(accessToken: string): FixtureItem {
    const item = this.items.get(accessToken);
    if (!item) throw new FeedProviderError("INVALID_TOKEN", "Unknown fixture access token");
    return item;
  }

  async listAccounts(accessToken: string): Promise<FeedAccount[]> {
    return this.item(accessToken).accounts;
  }

  async sync(accessToken: string, cursor: string | null): Promise<SyncPage> {
    const item = this.item(accessToken);
    const index = cursor ? Number(cursor) : 0;
    const step = item.steps[index];
    if (!step) return { added: [], modified: [], removed: [], nextCursor: String(index), hasMore: false };
    if ("error" in step) {
      // An error step is consumed once, so a retry from the same cursor proceeds (like a transient provider fault).
      item.steps.splice(index, 1);
      throw new FeedProviderError(step.error, step.message ?? step.error, step.error === "MUTATION_DURING_PAGINATION" || step.error === "RATE_LIMIT");
    }
    return { ...step, nextCursor: String(index + 1) };
  }

  async remove(accessToken: string): Promise<void> {
    this.items.delete(accessToken);
  }
}

export function createFeedProvider(config: Pick<Config, "PLAID_CLIENT_ID" | "PLAID_SECRET" | "PLAID_ENV">, warn?: (msg: string) => void): FeedProvider {
  const env = config.PLAID_ENV ?? (config.PLAID_CLIENT_ID ? "sandbox" : "fixture");
  if (env !== "fixture" && config.PLAID_CLIENT_ID && config.PLAID_SECRET) return new PlaidProvider(config.PLAID_CLIENT_ID, config.PLAID_SECRET, env);
  warn?.("PLAID_CLIENT_ID not set: bank feeds use the offline fixture bank");
  return new FixtureProvider();
}
