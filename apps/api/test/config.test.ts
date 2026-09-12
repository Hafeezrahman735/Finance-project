import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("config", () => {
  it("names every missing required variable and points at the docs", () => {
    expect(() => loadConfig({})).toThrowError(/MONGO_URL is missing.*docs\/setup\.md[\s\S]*JWT_SECRET is missing/);
  });

  it("applies defaults and coerces PORT", () => {
    const c = loadConfig({ MONGO_URL: "mongodb://x", JWT_SECRET: "0123456789abcdef", PORT: "8000" });
    expect(c.PORT).toBe(8000);
    expect(c.LOG_LEVEL).toBe("info");
    expect(c.NODE_ENV).toBe("development");
  });
});
