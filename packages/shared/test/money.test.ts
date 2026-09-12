import { describe, expect, it } from "vitest";
import { assertSafeMinor, bigintToMinor, floatToMinor, formatMoney, fromMinorString, sumMinor, toMinor } from "../src/money.js";

describe("toMinor", () => {
  it.each([
    ["1234.56", 123456],
    ["1,234.56", 123456],
    ["$1,234.56", 123456],
    ["(12.34)", -1234],
    ["-12.34", -1234],
    ["+5", 500],
    ["0.005", 1],
    ["0.004", 0],
    ["12", 1200],
    [".5", 50],
    ["1234.5678", 123457],
    [1234.56, 123456],
    [0.1 + 0.2, 30],
    [-0.005, -1],
  ])("parses %s → %d", (input, expected) => {
    expect(toMinor(input as string | number)).toBe(expected);
  });

  it("returns null for blank input and throws for garbage", () => {
    expect(toMinor("   ")).toBeNull();
    expect(() => toMinor("12,50")).toThrow(/not a valid amount/);
    expect(() => toMinor("abc")).toThrow(/not a valid amount/);
    expect(() => toMinor("1.2.3")).toThrow(/not a valid amount/);
    expect(() => toMinor(Number.NaN)).toThrow(/finite/);
  });

  it("respects zero-exponent currencies", () => {
    expect(toMinor("1234.6", "JPY")).toBe(1235);
    expect(fromMinorString(1235, "JPY")).toBe("1235");
    expect(() => toMinor("1", "XXX")).toThrow(/Unsupported currency/);
  });
});

describe("boundaries", () => {
  it("guards the JSON wire format below 2^53", () => {
    expect(assertSafeMinor(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => assertSafeMinor(Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe integer/);
    expect(() => assertSafeMinor(1.5)).toThrow(/integer/);
    expect(bigintToMinor(123n)).toBe(123);
    expect(() => bigintToMinor(2n ** 53n)).toThrow(/safe integer/);
  });

  it("sums with bigint internally so intermediate overflow cannot round", () => {
    expect(sumMinor([Number.MAX_SAFE_INTEGER - 5, 5])).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => sumMinor([Number.MAX_SAFE_INTEGER, 1])).toThrow(/safe integer/);
    expect(sumMinor([100, -250, 50])).toBe(-100);
  });
});

describe("formatting", () => {
  it("renders decimal strings and localized currency", () => {
    expect(fromMinorString(123456)).toBe("1234.56");
    expect(fromMinorString(-5)).toBe("-0.05");
    expect(fromMinorString(0)).toBe("0.00");
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(formatMoney(-1234)).toBe("-$12.34");
    expect(formatMoney(1234, "USD", "en-US", { signDisplay: "always" })).toBe("+$12.34");
  });

  it("converts legacy floats per row", () => {
    expect(floatToMinor(19.99)).toBe(1999);
    expect(floatToMinor(0.285)).toBe(29);
    expect(floatToMinor(1.005)).toBe(101);
  });
});
