import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UserProvider from "../src/context/UserProvider";

vi.mock("../src/lib/api", () => ({
  dashboard: { get: vi.fn() },
  metrics: { get: vi.fn().mockRejectedValue(new Error("no metrics")) },
  briefs: { peek: vi.fn().mockResolvedValue({ enabled: true, brief: { brief: { headline: "You kept $550.00 of $1,000.00 in sales." } } }) },
  auth: { me: vi.fn().mockResolvedValue({ user: { id: "u1", fullName: "Demo Owner", email: "demo@ledgeriq.local" }, organization: { id: "o1", name: "Sunny Side Studio", role: "OWNER" } }) },
  errorMessage: (e, f) => e?.message || f,
}));

import { dashboard, metrics } from "../src/lib/api";
import Overview from "../src/pages/Overview";

const base = {
  currency: "USD",
  timezone: "America/Chicago",
  today: "2026-09-12",
  totalBalanceMinor: 0,
  totalIncomeMinor: 0,
  totalExpenseMinor: 0,
  cashOnHandMinor: 0,
  uncategorizedCount: 0,
  last30Days: { from: "2026-08-14", to: "2026-09-12", incomeMinor: 0, expenseMinor: 0, transactions: [], daily: [] },
  last60DaysIncome: { from: "2026-07-15", to: "2026-09-12", totalMinor: 0, transactions: [] },
  recentTransactions: [],
};

function renderOverview() {
  localStorage.setItem("token", "t");
  return render(
    <MemoryRouter>
      <UserProvider>
        <Overview />
      </UserProvider>
    </MemoryRouter>,
  );
}

describe("Overview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the headline in the empty state and offers one primary action", async () => {
    dashboard.get.mockResolvedValue(base);
    renderOverview();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Nothing recorded yet. Add a transaction and this line will tell you what happened.");
    expect(screen.getByRole("button", { name: "Import a statement" })).toBeInTheDocument();
    expect(screen.queryByText("Last 30 days")).not.toBeInTheDocument();
  });

  it("reads the partial state (all uncategorized) as muted and points at the queue", async () => {
    dashboard.get.mockResolvedValue({
      ...base,
      totalExpenseMinor: 410000,
      cashOnHandMinor: 853570,
      uncategorizedCount: 150,
      last30Days: { ...base.last30Days, expenseMinor: 410000, daily: [{ date: "2026-09-12", inMinor: 0, outMinor: 410000 }] },
      recentTransactions: [{ id: "t1", date: "2026-09-12", memo: "PIRATE SHIP", direction: "out", amountMinor: 3080, currency: "USD", categoryName: "Uncategorized", uncategorized: true }],
    });
    renderOverview();
    const h1 = await screen.findByRole("heading", { level: 1 });
    expect(h1).toHaveTextContent("About $4,100.00 went out in the last 30 days. Categorize to see where.");
    expect(h1).toHaveClass("text-muted");
    expect(screen.getByText("$8,535.70")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Categorize 150" })).toBeInTheDocument();
    expect(screen.getByText("needs a category")).toBeInTheDocument();
  });

  it("shows the live headline, cash line, and the recent list", async () => {
    dashboard.get.mockResolvedValue({
      ...base,
      totalIncomeMinor: 1166806,
      totalExpenseMinor: 1053544,
      cashOnHandMinor: 853570,
      last30Days: { ...base.last30Days, incomeMinor: 680000, expenseMinor: 360000, daily: [{ date: "2026-09-12", inMinor: 680000, outMinor: 360000 }] },
      recentTransactions: [{ id: "t2", date: "2026-09-11", memo: "SHOPIFY PAYOUT", direction: "in", amountMinor: 28600, currency: "USD", categoryName: "Shopify Payments clearing", uncategorized: false }],
    });
    renderOverview();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("You brought in $3,200.00 more than you spent in the last 30 days.");
    expect(screen.getByRole("button", { name: "Review transactions" })).toBeInTheDocument();
    expect(screen.getByText("SHOPIFY PAYOUT")).toBeInTheDocument();
    expect(screen.getByText("+$286.00")).toHaveClass("text-positive");
  });

  it("shows runway on the secondary line and the Numbers section with per-channel rows and recurring charges", async () => {
    dashboard.get.mockResolvedValue({ ...base, totalIncomeMinor: 100000, totalExpenseMinor: 60000, cashOnHandMinor: 85000, last30Days: { ...base.last30Days, incomeMinor: 100000, expenseMinor: 60000 } });
    const m = (id, label, value, unit, display, extra = {}) => ({ id, label, value, unit, display, window: null, ...extra });
    metrics.get.mockResolvedValueOnce({
      currency: "USD",
      window: { from: "2026-08-14", to: "2026-09-12" },
      dataDays: 40,
      insufficientData: false,
      channels: [{ id: "c1", name: "TikTok Shop", kind: "TIKTOK_SHOP" }],
      recurring: [{ slug: "canva", memo: "CANVA", cadence: "monthly", amountMinor: 2999, prevAmountMinor: 1299, deltaPct: 130.9, lastDate: "2026-09-06", occurrences: 3 }],
      processors: [{ key: "stripe", name: "Stripe", balanceMinor: 63000, lastPayoutDate: "2026-09-01", daysSinceLastPayout: 11 }],
      metrics: [
        m("runway_days", "Runway", 170, "days", "170 days"),
        m("net_burn_30d", "Net burn", 15000, "minor", "$150.00", { prev: { value: 9000, display: "$90.00" } }),
        m("gross_margin_30d", "Gross margin", 55000, "minor", "$550.00"),
        m("gross_margin_pct_30d", "Gross margin rate", 55, "percent", "55.0%"),
        m("ad_spend_30d", "Ad spend", 25000, "minor", "$250.00"),
        m("roas_30d", "Blended ROAS", 4, "ratio", "4.0x"),
        m("processor_fees_30d", "Processor fees", 5000, "minor", "$50.00"),
        m("fee_rate_30d", "Effective fee rate", 5, "percent", "5.0%"),
        m("recurring_monthly_total", "Recurring charges per month", 2999, "minor", "$29.99", { note: "1 recurring charge detected over 90 days." }),
        m("clearing_balance", "Earned, not yet deposited", 63000, "minor", "$630.00"),
        m("channel:c1:revenue", "TikTok Shop revenue", 100000, "minor", "$1,000.00"),
        m("channel:c1:fee_rate", "TikTok Shop fee rate", 5, "percent", "5.0%"),
        m("channel:c1:cogs", "TikTok Shop COGS", 40000, "minor", "$400.00"),
        m("channel:c1:ad_spend", "TikTok Shop ad spend", 25000, "minor", "$250.00"),
        m("channel:c1:gross_margin", "TikTok Shop gross margin", 55000, "minor", "$550.00"),
        m("channel:c1:gross_margin_pct", "TikTok Shop gross margin rate", 55, "percent", "55.0%"),
        m("channel:c1:roas", "TikTok Shop ROAS", 4, "ratio", "4.0x"),
      ],
    });
    renderOverview();
    expect(await screen.findByText(/about 170 days of runway/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Numbers" })).toBeInTheDocument();
    expect(screen.getByText("was $90.00")).toBeInTheDocument();
    expect(screen.getByText(/blended ROAS 4.0x/)).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /TikTok Shop/ })).toHaveTextContent("$1,000.005.0%$400.00$250.00$550.00 · 55.0%4.0x");
    expect(screen.getByText("CANVA")).toBeInTheDocument();
    expect(screen.getByText(/up 131%/)).toBeInTheDocument();
    expect(screen.getByText(/Stripe: 11 days since the last payout/)).toBeInTheDocument();
    expect(await screen.findByText(/This week's brief:/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read" })).toHaveAttribute("href", "/brief");
  });

  it("surfaces a load error with a retry", async () => {
    dashboard.get.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(base);
    renderOverview();
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
