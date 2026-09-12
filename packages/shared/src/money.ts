/**
 * Money is integer minor units (cents) everywhere (ADR 0002).
 *
 *   database  BIGINT
 *   wire      JSON number, guarded below 2^53 (Number.MAX_SAFE_INTEGER)
 *   display   formatMoney() via Intl.NumberFormat, nowhere else
 *
 * No float arithmetic on money paths: convert at the edges with toMinor /
 * fromMinorString, compute with integers in between.
 */

export type Minor = number; // integer minor units; always pass through assertSafeMinor at boundaries

export const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;

/** Minor-unit exponent per currency. Only what launch needs; extend when multi-currency lands. */
const EXPONENTS: Record<string, number> = { USD: 2, CAD: 2, EUR: 2, GBP: 2, AUD: 2, JPY: 0 };

export function minorExponent(currency: string): number {
  const exp = EXPONENTS[currency.toUpperCase()];
  if (exp === undefined) throw new MoneyError(`Unsupported currency ${currency}`, "unsupported_currency");
  return exp;
}

export class MoneyError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Throws unless `value` is an integer the JSON wire format can carry exactly. */
export function assertSafeMinor(value: unknown, label = "amount"): Minor {
  if (typeof value === "bigint") {
    if (value > BigInt(MAX_SAFE_MINOR) || value < -BigInt(MAX_SAFE_MINOR)) {
      throw new MoneyError(`${label} exceeds the safe integer range`, "amount_out_of_range");
    }
    return Number(value);
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer number of minor units`, "amount_not_integer");
  }
  if (!Number.isSafeInteger(value)) throw new MoneyError(`${label} exceeds the safe integer range`, "amount_out_of_range");
  return value;
}

/** Prisma returns BIGINT columns as bigint; convert at the API boundary. */
export function bigintToMinor(value: bigint, label = "amount"): Minor {
  return assertSafeMinor(value, label);
}

/**
 * Parses a human-entered amount ("1,234.56", "(12.34)", "-12.34", "$99", "12,50" is NOT accepted)
 * into minor units. Rounds half away from zero at the currency's exponent.
 * Returns null for blank input so callers can decide whether blank means 0 or invalid.
 */
export function toMinor(input: string | number, currency = "USD"): Minor | null {
  const exp = minorExponent(currency);
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new MoneyError("amount is not a finite number", "amount_invalid");
    // Go through the shortest round-trip decimal string so 1.005 rounds to 1.01,
    // not to 1.00 via the float product 100.49999999999999.
    const text = input.toString();
    if (/e/i.test(text)) throw new MoneyError("amount is outside the supported range", "amount_out_of_range");
    return toMinor(text, currency);
  }
  let s = input.trim();
  if (s === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/[$€£¥]/g, "").trim();
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  // Commas are accepted only as thousands separators ("1,234.56"); a decimal
  // comma ("12,50") is rejected rather than silently read as 1250.
  if (s.includes(",")) {
    if (!/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) throw new MoneyError(`"${input}" is not a valid amount`, "amount_invalid");
    s = s.replace(/,/g, "");
  }
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") throw new MoneyError(`"${input}" is not a valid amount`, "amount_invalid");
  const [wholeRaw = "", fracRaw = ""] = s.split(".");
  const whole = wholeRaw === "" ? "0" : wholeRaw;
  // Keep one extra digit for rounding, pad the rest.
  const frac = (fracRaw + "0".repeat(exp + 1)).slice(0, exp + 1);
  const scaled = BigInt(whole) * BigInt(10 ** (exp + 1)) + BigInt(frac || "0");
  const rounded = (scaled + 5n) / 10n; // half away from zero on the magnitude
  const minor = assertSafeMinor(rounded, "amount");
  return negative ? -minor : minor;
}

/** Legacy float → minor. Used by the Mongo migration; per-row rounding (ADR 0002). */
export function floatToMinor(value: number, currency = "USD"): Minor {
  return toMinor(value, currency) ?? 0;
}

/** Minor units → decimal string with the currency's exponent, no grouping ("1234.56"). */
export function fromMinorString(minor: Minor, currency = "USD"): string {
  const exp = minorExponent(currency);
  assertSafeMinor(minor);
  const negative = minor < 0;
  const abs = Math.abs(minor).toString().padStart(exp + 1, "0");
  const whole = exp === 0 ? abs : abs.slice(0, -exp);
  const frac = exp === 0 ? "" : "." + abs.slice(-exp);
  return `${negative ? "-" : ""}${whole}${frac}`;
}

/** Display formatting. The only place money becomes a localized string. */
export function formatMoney(minor: Minor, currency = "USD", locale = "en-US", opts: { signDisplay?: "auto" | "always" | "never" | "exceptZero" } = {}): string {
  assertSafeMinor(minor);
  const exp = minorExponent(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
    signDisplay: opts.signDisplay ?? "auto",
  }).format(minor / 10 ** exp);
}

export function sumMinor(values: Iterable<Minor>): Minor {
  let total = 0n;
  for (const v of values) total += BigInt(assertSafeMinor(v));
  return assertSafeMinor(total, "sum");
}
