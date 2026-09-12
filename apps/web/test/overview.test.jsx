import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UserProvider from "../src/context/UserProvider";

vi.mock("../src/lib/api", () => ({
  dashboard: { get: vi.fn() },
  auth: { me: vi.fn().mockResolvedValue({ user: { id: "u1", fullName: "Demo Owner", email: "demo@ledgeriq.local" }, organization: { id: "o1", name: "Sunny Side Studio", role: "OWNER" } }) },
  errorMessage: (e, f) => e?.message || f,
}));

import { dashboard } from "../src/lib/api";
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
    expect(screen.getByRole("button", { name: "Add a transaction" })).toBeInTheDocument();
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

  it("surfaces a load error with a retry", async () => {
    dashboard.get.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(base);
    renderOverview();
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
