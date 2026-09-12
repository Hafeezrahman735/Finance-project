import { addDays, differenceInCalendarDays, isValid, parseISO, startOfWeek } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/**
 * Business dates are calendar days in the organization's timezone, stored as
 * DATE (no time) and carried on the wire as "YYYY-MM-DD" strings (ADR 0004,
 * eng review finding F5). Never compare a DATE to Date.now() - 30d.
 */
export type CalendarDate = string; // YYYY-MM-DD

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDate(value: unknown): value is CalendarDate {
  return typeof value === "string" && ISO_DATE.test(value) && isValid(parseISO(value));
}

export function assertCalendarDate(value: unknown, label = "date"): CalendarDate {
  if (!isCalendarDate(value)) throw new Error(`${label} must be a calendar date in YYYY-MM-DD form`);
  return value;
}

/** Today's calendar date in a timezone (IANA name, e.g. "America/Chicago"). */
export function todayIn(timeZone: string, now: Date = new Date()): CalendarDate {
  return formatInTimeZone(now, timeZone, "yyyy-MM-dd");
}

/** Calendar date of an instant, as seen in a timezone. */
export function calendarDateIn(instant: Date, timeZone: string): CalendarDate {
  return formatInTimeZone(instant, timeZone, "yyyy-MM-dd");
}

/** Add whole calendar days (DST-safe because it works on the date string, not on instants). */
export function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const d = parseISO(assertCalendarDate(date));
  return formatUtcDate(addDays(d, days));
}

export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return differenceInCalendarDays(parseISO(assertCalendarDate(to)), parseISO(assertCalendarDate(from)));
}

/** Inclusive window ending today: [today - (days - 1), today]. "Last 30 days" = 30 calendar days. */
export function lastNDays(days: number, timeZone: string, now: Date = new Date()): { from: CalendarDate; to: CalendarDate } {
  const to = todayIn(timeZone, now);
  return { from: addCalendarDays(to, -(days - 1)), to };
}

/** Monday that starts the week containing `date` (ISO weeks; the weekly brief's period start). */
export function weekStartMonday(date: CalendarDate): CalendarDate {
  return formatUtcDate(startOfWeek(parseISO(assertCalendarDate(date)), { weekStartsOn: 1 }));
}

/** The instant at which a calendar day begins in a timezone (for job scheduling, not for storage). */
export function startOfCalendarDay(date: CalendarDate, timeZone: string): Date {
  return fromZonedTime(`${assertCalendarDate(date)}T00:00:00`, timeZone);
}

/** Convert a DATE column value (Prisma returns a Date at UTC midnight) to a calendar string. */
export function dateColumnToCalendar(value: Date): CalendarDate {
  return formatUtcDate(value);
}

/** Convert a calendar string to the Date Prisma expects for a DATE column (UTC midnight). */
export function calendarToDateColumn(date: CalendarDate): Date {
  return new Date(`${assertCalendarDate(date)}T00:00:00.000Z`);
}

/** Legacy timestamp (e.g. Mongo `date`) → calendar date in a timezone. Used by the migration. */
export function timestampToCalendar(ts: Date, timeZone: string): CalendarDate {
  return calendarDateIn(ts, timeZone);
}

function formatUtcDate(d: Date): CalendarDate {
  return formatInTimeZone(d, "UTC", "yyyy-MM-dd");
}
