import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  calendarDateIn,
  calendarToDateColumn,
  dateColumnToCalendar,
  daysBetween,
  isCalendarDate,
  lastNDays,
  startOfCalendarDay,
  timestampToCalendar,
  todayIn,
  weekStartMonday,
} from "../src/dates.js";

describe("calendar dates", () => {
  it("validates the YYYY-MM-DD form", () => {
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2026-9-1")).toBe(false);
    expect(isCalendarDate(new Date())).toBe(false);
  });

  it("derives today from the organization timezone, not the server clock", () => {
    const instant = new Date("2026-03-08T04:30:00Z"); // 23:30 the previous day in Chicago
    expect(todayIn("UTC", instant)).toBe("2026-03-08");
    expect(todayIn("America/Chicago", instant)).toBe("2026-03-07");
    expect(todayIn("Asia/Tokyo", instant)).toBe("2026-03-08");
    expect(calendarDateIn(instant, "Pacific/Auckland")).toBe("2026-03-08");
  });

  it("counts calendar days across a DST change without drifting", () => {
    // US DST starts 2026-03-08. A 30-day window in Chicago must still be 30 dates.
    const { from, to } = lastNDays(30, "America/Chicago", new Date("2026-03-20T18:00:00Z"));
    expect(to).toBe("2026-03-20");
    expect(from).toBe("2026-02-19");
    expect(daysBetween(from, to)).toBe(29);
    expect(addCalendarDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addCalendarDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("finds the Monday that starts a week", () => {
    expect(weekStartMonday("2026-09-12")).toBe("2026-09-07"); // Saturday → Monday
    expect(weekStartMonday("2026-09-07")).toBe("2026-09-07");
    expect(weekStartMonday("2026-09-06")).toBe("2026-08-31"); // Sunday belongs to the previous ISO week
  });

  it("maps DATE column values and instants both ways", () => {
    expect(dateColumnToCalendar(new Date("2026-09-12T00:00:00.000Z"))).toBe("2026-09-12");
    expect(calendarToDateColumn("2026-09-12").toISOString()).toBe("2026-09-12T00:00:00.000Z");
    expect(startOfCalendarDay("2026-03-08", "America/Chicago").toISOString()).toBe("2026-03-08T06:00:00.000Z");
    expect(startOfCalendarDay("2026-03-09", "America/Chicago").toISOString()).toBe("2026-03-09T05:00:00.000Z"); // after DST
    expect(timestampToCalendar(new Date("2026-09-12T03:00:00Z"), "America/Los_Angeles")).toBe("2026-09-11");
  });
});
