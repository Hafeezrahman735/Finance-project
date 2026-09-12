import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import CategoryPicker from "../src/components/transactions/CategoryPicker";
import TransactionRow from "../src/components/transactions/TransactionRow";

const accounts = [
  { id: "a-cash", name: "Cash", type: "ASSET", systemKey: "cash" },
  { id: "a-sales", name: "Sales", type: "INCOME", systemKey: "sales" },
  { id: "a-rent", name: "Rent", type: "EXPENSE", systemKey: "rent" },
  { id: "a-soft", name: "Software and subscriptions", type: "EXPENSE", systemKey: "software" },
  { id: "a-unc", name: "Uncategorized", type: "EXPENSE", systemKey: "uncategorized" },
];

const txn = {
  id: "t1",
  date: "2026-09-12",
  memo: "PIRATE SHIP",
  direction: "out",
  amountMinor: 3080,
  currency: "USD",
  bankAccount: { id: "a-cash", name: "Cash" },
  lines: [{ accountId: "a-unc", accountName: "Uncategorized", amountMinor: 3080, channelId: null }],
  categoryName: "Uncategorized",
  uncategorized: true,
  status: "POSTED",
  locked: false,
  source: "BANK",
  version: 1,
};

describe("TransactionRow", () => {
  it("shows description, date, amount with sign, and the category call to action for uncategorized rows", () => {
    render(
      <ul>
        <TransactionRow t={txn} selected={false} selectable={false} onSelect={() => {}} onCategory={() => {}} />
      </ul>,
    );
    expect(screen.getByText("PIRATE SHIP")).toBeInTheDocument();
    expect(screen.getAllByText("Sep 12").length).toBeGreaterThan(0);
    expect(screen.getByText("−$30.80")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /choose a category/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("listitem")).toHaveClass("border-l-accent");
  });

  it("renders money in as positive and shows the category name once categorized", () => {
    const paid = { ...txn, direction: "in", uncategorized: false, categoryName: "Sales", lines: [{ accountId: "a-sales", accountName: "Sales", amountMinor: 3080, channelId: null }] };
    render(
      <ul>
        <TransactionRow t={paid} selected={false} selectable={false} onSelect={() => {}} onCategory={() => {}} />
      </ul>,
    );
    expect(screen.getByText("+$30.80")).toHaveClass("text-positive");
    expect(screen.getAllByRole("button", { name: "Sales" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("listitem")).not.toHaveClass("border-l-accent");
  });
});

describe("CategoryPicker", () => {
  it("searches accounts (never the bank account), picks one, and passes the full amount", async () => {
    const onPick = vi.fn();
    render(<CategoryPicker open onClose={() => {}} accounts={accounts} amountMinor={3080} direction="out" current={txn.lines} onPick={onPick} />);
    const search = screen.getByRole("combobox", { name: /search categories/i });
    expect(screen.queryByText("Cash")).not.toBeInTheDocument();
    await userEvent.type(search, "soft");
    expect(screen.getByText("Software and subscriptions")).toBeInTheDocument();
    expect(screen.queryByText("Rent")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Software and subscriptions"));
    expect(onPick).toHaveBeenCalledWith([{ accountId: "a-soft", amountMinor: 3080 }]);
  });

  it("splits only when the lines sum to the amount", async () => {
    const onPick = vi.fn();
    render(<CategoryPicker open onClose={() => {}} accounts={accounts} amountMinor={10000} direction="out" current={txn.lines} onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: /split across categories/i }));
    const dialog = screen.getByRole("dialog");
    const selects = within(dialog).getAllByRole("combobox");
    await userEvent.selectOptions(selects[0], "a-rent");
    await userEvent.selectOptions(selects[1], "a-soft");
    const amounts = within(dialog).getAllByRole("textbox");
    await userEvent.clear(amounts[0]);
    await userEvent.type(amounts[0], "70");
    expect(screen.getByRole("button", { name: /save split/i })).toBeDisabled(); // 70 + 50 ≠ 100
    await userEvent.click(screen.getByRole("button", { name: /put the rest on the last line/i }));
    expect(screen.getByRole("button", { name: /save split/i })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: /save split/i }));
    expect(onPick).toHaveBeenCalledWith([
      { accountId: "a-rent", amountMinor: 7000 },
      { accountId: "a-soft", amountMinor: 3000 },
    ]);
  });
});
