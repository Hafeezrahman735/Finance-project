import { describe, expect, it } from "vitest";
import { applyMapping, dedupeHash, guessMapping, inferDateFormat, normalizeDescription, parseAnyDate, parseCsv, withHashes } from "../src/services/banking/csv.js";

// No database needed: pure parsing.
describe("parseCsv", () => {
  it("handles BOM, CRLF, quoted commas, blank lines, and ragged rows", () => {
    const text = "﻿Date,Description,Amount\r\n09/01/2026,\"COFFEE, DOWNTOWN\",-4.50\r\n\r\n09/02/2026,PAYROLL,\"1,250.00\",extra\r\n";
    const { columns, rows, delimiter } = parseCsv(Buffer.from(text, "utf8"));
    expect(delimiter).toBe(",");
    expect(columns).toEqual(["Date", "Description", "Amount"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ Date: "09/01/2026", Description: "COFFEE, DOWNTOWN", Amount: "-4.50" });
    expect(rows[1]!.Amount).toBe("1,250.00");
  });

  it("sniffs semicolon and tab delimiters and names blank headers", () => {
    expect(parseCsv("Datum;;Betrag\n2026-09-01;x;-1,00\n").columns).toEqual(["Datum", "column_2", "Betrag"]);
    expect(parseCsv("Date\tMemo\tAmount\n2026-09-01\tA\t1\n").delimiter).toBe("\t");
  });

  it("refuses files over the row cap", () => {
    const big = "Date,Description,Amount\n" + "2026-09-01,x,1\n".repeat(50_001);
    expect(() => parseCsv(big)).toThrow(/more than 50,000 rows/);
  });
});

describe("dates", () => {
  it("parses ISO, US, EU, textual, and time-suffixed dates", () => {
    expect(parseAnyDate("2026-09-01", "auto")).toBe("2026-09-01");
    expect(parseAnyDate("2026/9/1", "auto")).toBe("2026-09-01");
    expect(parseAnyDate("09/01/2026", "MDY")).toBe("2026-09-01");
    expect(parseAnyDate("01/09/2026", "DMY")).toBe("2026-09-01");
    expect(parseAnyDate("1.9.2026", "DMY")).toBe("2026-09-01");
    expect(parseAnyDate("Sep 1, 2026", "auto")).toBe("2026-09-01");
    expect(parseAnyDate("1 Sep 2026", "auto")).toBe("2026-09-01");
    expect(parseAnyDate("09/01/2026 14:32", "MDY")).toBe("2026-09-01");
    expect(parseAnyDate("09/01/26", "MDY")).toBe("2026-09-01");
    expect(parseAnyDate("not a date", "auto")).toBeNull();
    expect(parseAnyDate("31/12/2026", "MDY")).toBeNull(); // month 31 does not exist
  });

  it("infers the format from a day over 12, and reports ambiguity otherwise", () => {
    expect(inferDateFormat(["01/02/2026", "13/02/2026"])).toBe("DMY");
    expect(inferDateFormat(["01/02/2026", "02/13/2026"])).toBe("MDY");
    expect(inferDateFormat(["01/02/2026", "03/04/2026"])).toBeNull();
    expect(inferDateFormat(["2026-01-02"])).toBe("YMD");
    expect(inferDateFormat(["Jan 2, 2026"])).toBe("MDY");
  });
});

describe("guessMapping", () => {
  it("finds date, description, amount by header and infers the date format", () => {
    const { columns, rows } = parseCsv("Posting Date,Payee,Amount,Balance\n13/09/2026,PIRATE SHIP,-30.80,1000.00\n14/09/2026,SHOPIFY PAYOUT,286.00,1286.00\n");
    const g = guessMapping(columns, rows);
    expect(g.mapping).toMatchObject({ dateColumn: "Posting Date", descriptionColumn: "Payee", amountColumn: "Amount", dateFormat: "DMY", signConvention: "negativeIsOut" });
    expect(g.dateAmbiguous).toBe(false);
    expect(g.evidence["Payee"]).toEqual(["PIRATE SHIP", "SHOPIFY PAYOUT"]);
  });

  it("prefers a debit/credit pair when both exist and flags ambiguous dates", () => {
    const { columns, rows } = parseCsv("Date,Details,Debit,Credit\n01/02/2026,Rent,1200.00,\n03/04/2026,Client A,,500.00\n");
    const g = guessMapping(columns, rows);
    expect(g.mapping).toMatchObject({ dateColumn: "Date", descriptionColumn: "Details", debitColumn: "Debit", creditColumn: "Credit" });
    expect(g.mapping.amountColumn).toBeUndefined();
    expect(g.dateAmbiguous).toBe(true);
  });

  it("falls back to content sniffing when headers are unhelpful", () => {
    const { columns, rows } = parseCsv("A,B,C\n2026-09-01,Something descriptive,12.34\n2026-09-02,Another one,-5.00\n");
    const g = guessMapping(columns, rows);
    expect(g.mapping).toMatchObject({ dateColumn: "A", descriptionColumn: "B", amountColumn: "C" });
  });
});

describe("applyMapping", () => {
  const mapping = { dateColumn: "Date", descriptionColumn: "Description", amountColumn: "Amount", dateFormat: "MDY" as const, signConvention: "negativeIsOut" as const };

  it("normalizes amounts (parens, thousands, currency symbols) with the sign convention", () => {
    const rows = [
      { Date: "09/01/2026", Description: "COFFEE", Amount: "(4.50)" },
      { Date: "09/02/2026", Description: "PAYROLL", Amount: "$1,250.00" },
      { Date: "09/03/2026", Description: "CARD", Amount: "12.34" },
    ];
    const out = applyMapping(rows, mapping, "USD");
    expect(out.map((r) => r.amountMinor)).toEqual([-450, 125000, 1234]);
    const flipped = applyMapping(rows, { ...mapping, signConvention: "positiveIsOut" }, "USD");
    expect(flipped.map((r) => r.amountMinor)).toEqual([450, -125000, -1234]);
  });

  it("combines debit and credit columns into one signed amount", () => {
    const out = applyMapping([{ D: "1.9.2026", M: "Rent", Debit: "1200.00", Credit: "" }, { D: "2.9.2026", M: "Client", Debit: "", Credit: "500" }, { D: "3.9.2026", M: "Both", Debit: "1", Credit: "1" }], { dateColumn: "D", descriptionColumn: "M", debitColumn: "Debit", creditColumn: "Credit", dateFormat: "DMY", signConvention: "negativeIsOut" }, "USD");
    expect(out[0]!.amountMinor).toBe(-120000);
    expect(out[1]!.amountMinor).toBe(50000);
    expect(out[2]!.problem).toMatch(/both debit and credit/);
  });

  it("reports a readable problem per bad row instead of failing the file", () => {
    const out = applyMapping([{ Date: "??", Description: "", Amount: "abc" }, { Date: "09/01/2026", Description: "Zero", Amount: "0" }], mapping, "USD");
    expect(out[0]!.problem).toMatch(/no date in "Date" \("\?\?"\); no amount in "Amount" \("abc"\); no description/);
    expect(out[1]!.problem).toBe("amount is zero");
  });
});

describe("dedupe", () => {
  it("normalizes descriptions so pending/posted drift and reference numbers do not defeat matching", () => {
    expect(normalizeDescription("  PIRATE   SHIP  ")).toBe("pirate ship");
    expect(normalizeDescription("STRIPE TRANSFER ST-1234567890")).toBe("stripe transfer st #");
    expect(normalizeDescription("Amazon.com*AB12 Purchase")).toBe("amazon com ab12 purchase");
  });

  it("keeps two identical same-day rows apart within a file and stable across re-uploads", () => {
    const mapping = { dateColumn: "Date", descriptionColumn: "Description", amountColumn: "Amount", dateFormat: "MDY" as const, signConvention: "negativeIsOut" as const };
    const rows = applyMapping([{ Date: "09/01/2026", Description: "COFFEE", Amount: "-5.00" }, { Date: "09/01/2026", Description: "coffee", Amount: "-5.00" }, { Date: "09/01/2026", Description: "TEA", Amount: "-5.00" }], mapping, "USD");
    const hashed = withHashes(rows, "acct-1");
    expect(hashed[0]!.hash).not.toBe(hashed[1]!.hash); // occurrence 0 vs 1
    expect(hashed[0]!.hash).toBe(dedupeHash("acct-1", "2026-09-01", -500, "COFFEE", 0));
    expect(hashed[1]!.hash).toBe(dedupeHash("acct-1", "2026-09-01", "COFFEE".length ? -500 : 0, "coffee", 1));
    expect(withHashes(rows, "acct-1").map((r) => r.hash)).toEqual(hashed.map((r) => r.hash)); // deterministic
    expect(withHashes(rows, "acct-2")[0]!.hash).not.toBe(hashed[0]!.hash); // per bank account
    expect(withHashes([{ ...rows[0]!, problem: "bad" }], "acct-1")[0]!.hash).toBeNull();
  });
});
