import { describe, expect, it } from "vitest";
import { headlineCopy, money, shortDate } from "../src/lib/format";

describe("format", () => {
  it("formats money from minor units and dates without timezone drift", () => {
    expect(money(123456)).toBe("$1,234.56");
    expect(money(-500)).toBe("-$5.00");
    expect(money(500, "USD", { signDisplay: "never" })).toBe("$5.00");
    expect(shortDate("2026-09-01")).toBe("Sep 1");
    expect(shortDate("2026-01-31", { year: true })).toBe("Jan 31, 2026");
  });

  it("writes the Overview headline for every state (terse CFO, one sentence)", () => {
    expect(headlineCopy({ incomeMinor: 0, expenseMinor: 0, uncategorizedCount: 0, hasAnyData: false })).toMatchObject({
      text: "Nothing recorded yet. Add a transaction and this line will tell you what happened.",
      muted: true,
    });
    expect(headlineCopy({ incomeMinor: 680000, expenseMinor: 360000, uncategorizedCount: 3, hasAnyData: true }).text).toBe("You brought in $3,200.00 more than you spent in the last 30 days.");
    expect(headlineCopy({ incomeMinor: 100000, expenseMinor: 250000, uncategorizedCount: 0, hasAnyData: true }).text).toBe("You spent $1,500.00 more than you brought in over the last 30 days.");
    expect(headlineCopy({ incomeMinor: 0, expenseMinor: 410000, uncategorizedCount: 150, hasAnyData: true })).toMatchObject({
      text: "About $4,100.00 went out in the last 30 days. Categorize to see where.",
      muted: true,
    });
    expect(headlineCopy({ incomeMinor: 5000, expenseMinor: 5000, uncategorizedCount: 0, hasAnyData: true }).text).toBe("Money in and money out were equal over the last 30 days.");
  });
});
