import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UserProvider from "../src/context/UserProvider";

vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../src/lib/api", () => ({
  briefs: { current: vi.fn(), regenerate: vi.fn() },
  auth: { me: vi.fn().mockResolvedValue({ user: { id: "u1", fullName: "Demo Owner", email: "demo@ledgeriq.local" }, organization: { id: "o1", name: "Sunny Side Studio", role: "OWNER" } }) },
  errorMessage: (e, f) => e?.message || f,
  errorCode: (e) => e?.response?.data?.error?.code,
}));

import toast from "react-hot-toast";
import { briefs } from "../src/lib/api";
import Brief from "../src/pages/Brief";

const metrics = {
  gross_margin_30d: { label: "Gross margin", display: "$2,350.46", window: { from: "2026-08-14", to: "2026-09-12" }, prev: "$1,744.39" },
  revenue_30d: { label: "Revenue", display: "$4,121.07", window: { from: "2026-08-14", to: "2026-09-12" } },
  gross_margin_pct_30d: { label: "Gross margin rate", display: "57.0%", window: { from: "2026-08-14", to: "2026-09-12" } },
  "recurring:canva:amount": { label: "CANVA (monthly)", display: "$29.99", window: null, prev: "$12.99" },
  "recurring:canva:delta_pct": { label: "CANVA change vs previous charge", display: "130.9%", window: null },
  uncategorized_count: { label: "Transactions needing a category", display: "5", window: null },
};

const generated = {
  id: "b1",
  periodStart: "2026-09-07",
  periodEnd: "2026-09-13",
  asOf: "2026-09-12",
  status: "GENERATED",
  model: "claude-opus-5",
  degradedReason: null,
  brief: {
    headline: "You kept $2,350.46 of $4,121.07 in sales: 57.0% gross margin.",
    warm_line: "Good month; one subscription needs a look.",
    findings: [
      { claim: "CANVA charged $29.99, up 130.9% from $12.99.", evidence_metric_ids: ["recurring:canva:amount", "recurring:canva:delta_pct"], severity: "high" },
      { claim: "5 transactions still need a category.", evidence_metric_ids: ["uncategorized_count"], severity: "info" },
    ],
    suggested_actions: [{ action: "Check the CANVA plan.", reason: "It more than doubled to $29.99.", confidence: "high" }],
    disclaimer: "Observations from your ledger, not advice.",
  },
  anomalies: [],
  metrics,
  insufficientData: false,
  dataDays: 88,
  firstOpen: true,
  regenerations: 0,
  createdAt: "2026-09-12T18:00:00.000Z",
};

function renderBrief() {
  localStorage.setItem("token", "t");
  return render(
    <MemoryRouter>
      <UserProvider>
        <Brief />
      </UserProvider>
    </MemoryRouter>,
  );
}

describe("Brief page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the first-open reveal, findings ordered as given, numbers with evidence popovers, and the footer", async () => {
    briefs.current.mockResolvedValue({ enabled: true, brief: generated });
    renderBrief();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("You kept $2,350.46 of $4,121.07 in sales: 57.0% gross margin.");
    expect(screen.getByText("Your first brief.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Here's what we noticed" })).toBeInTheDocument();
    expect(screen.getByText(/Week of Sep 7, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Narrated by claude-opus-5/)).toBeInTheDocument();

    // every number in the headline is a button that opens the metric behind it
    const headline = screen.getByRole("heading", { level: 1 });
    const buttons = within(headline).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["$2,350.46", "$4,121.07", "57.0%"]);
    await userEvent.click(buttons[0]);
    expect(await screen.findByText("Gross margin")).toBeInTheDocument();
    expect(screen.getByText(/was \$1,744.39/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See transactions" })).toHaveAttribute("href", "/transactions");

    // recurring evidence links to a memo search; the queue count to the queue filter
    await userEvent.click(screen.getAllByRole("button", { name: "$29.99" })[0]);
    expect(await screen.findByText("CANVA (monthly)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See transactions" })).toHaveAttribute("href", "/transactions?q=CANVA");
    await userEvent.click(screen.getByRole("button", { name: "5" }));
    expect(await screen.findByText("Transactions needing a category")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See transactions" })).toHaveAttribute("href", "/transactions?filter=queue");
  });

  it("renders a degraded brief as this week's numbers with a note, and the switched-off state", async () => {
    briefs.current.mockResolvedValueOnce({ enabled: true, brief: { ...generated, status: "DEGRADED", model: null, degradedReason: "model_unavailable: AI_PROVIDER=off", firstOpen: false } });
    renderBrief();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("This week's numbers");
    expect(screen.getByRole("note")).toHaveTextContent("AI narration unavailable this week");
    expect(screen.queryByText("Your first brief.")).not.toBeInTheDocument();
    expect(screen.getByText(/Deterministic summary/)).toBeInTheDocument();

    briefs.current.mockResolvedValueOnce({ enabled: false, brief: null });
    renderBrief();
    expect(await screen.findByText(/The weekly brief is switched off/)).toBeInTheDocument();
  });

  it("owners can refresh; the weekly cap is explained", async () => {
    briefs.current.mockResolvedValue({ enabled: true, brief: { ...generated, firstOpen: false } });
    briefs.regenerate.mockRejectedValueOnce({ response: { data: { error: { code: "brief_regeneration_limit" } } } });
    renderBrief();
    await userEvent.click(await screen.findByRole("button", { name: "Refresh this week's brief" }));
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Refreshed enough for one week/)));
  });
});
