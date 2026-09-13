import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserContext } from "../src/context/userContext";

vi.mock("react-hot-toast", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../src/lib/api", () => ({
  bankConnections: { provider: vi.fn(), list: vi.fn(), linkToken: vi.fn(), connect: vi.fn(), sync: vi.fn(), reconnected: vi.fn(), remove: vi.fn() },
  errorMessage: (e, f) => e?.message || f,
}));

import toast from "react-hot-toast";
import BankConnections from "../src/components/banking/BankConnections";
import { bankConnections as api } from "../src/lib/api";

const conn = {
  id: "c1",
  institutionName: "Fixture Bank",
  status: "ACTIVE",
  lastSyncedAt: new Date(Date.now() - 5 * 60000).toISOString(),
  lastError: null,
  transactionCount: 38,
  accounts: [
    { id: "b1", name: "Fixture Bank Fixture Checking" },
    { id: "b2", name: "Fixture Bank Fixture Rewards Card" },
  ],
};

function renderAs(role, props = {}) {
  return render(
    <UserContext.Provider value={{ user: { id: "u1" }, organization: { id: "o1", name: "Org", role }, updateUser: () => {}, clearUser: () => {} }}>
      <BankConnections {...props} />
    </UserContext.Provider>,
  );
}

describe("BankConnections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.provider.mockResolvedValue({ name: "fixture", env: "fixture" });
  });

  it("connects the fixture bank without Plaid Link and reports the first sync", async () => {
    api.list.mockResolvedValueOnce([]).mockResolvedValueOnce([conn]);
    api.linkToken.mockResolvedValue({ linkToken: "fixture-link-token", provider: "fixture", env: "fixture", updateMode: false });
    api.connect.mockResolvedValue({ connection: conn, sync: { added: 38, modified: 0, removed: 0 } });
    const onChange = vi.fn();
    renderAs("OWNER", { onChange });
    expect(await screen.findByText("No bank connected yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Connect a bank (beta)" }));
    await waitFor(() => expect(api.connect).toHaveBeenCalledWith({ publicToken: "fixture-public-token", institutionName: "Fixture Bank" }));
    expect(toast.success).toHaveBeenCalledWith("Fixture Bank connected: 38 transactions in");
    expect(await screen.findByText("Fixture Bank")).toBeInTheDocument();
    expect(screen.getByText(/Fixture Checking · Fixture Rewards Card · 38 transactions · synced 5 min ago/)).toBeInTheDocument();
    expect(onChange).toHaveBeenCalled();
  });

  it("syncs on demand and shows the reconnect path when the bank wants a fresh login", async () => {
    api.list.mockResolvedValueOnce([conn]).mockResolvedValueOnce([{ ...conn, status: "NEEDS_REAUTH", lastError: "ITEM_LOGIN_REQUIRED" }]).mockResolvedValueOnce([conn]);
    api.sync.mockResolvedValue({ status: "NEEDS_REAUTH", added: 0, modified: 0, removed: 0 });
    api.linkToken.mockResolvedValue({ linkToken: "fixture-link-token", provider: "fixture", updateMode: true });
    api.reconnected.mockResolvedValue({ status: "ACTIVE", added: 2 });
    renderAs("BOOKKEEPER");
    await userEvent.click(await screen.findByRole("button", { name: "Sync now" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/wants you to log in again/);
    await userEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(api.reconnected).toHaveBeenCalledWith("c1"));
    expect(toast.success).toHaveBeenLastCalledWith("Fixture Bank reconnected: 2 new");
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument(); // bookkeepers cannot remove
  });

  it("viewers see the list but no actions", async () => {
    api.list.mockResolvedValue([conn]);
    renderAs("VIEWER");
    expect(await screen.findByText("Fixture Bank")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
