import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  describeDueDate,
  formatCalendarDate,
  formatRecentInstant,
  hourInTimeZone,
  isOverdue,
  schoolYearLabel,
  todayInTimeZone,
} from "@/lib/dates";

describe("dates", () => {
  it("computes today in the teacher's time zone, not the server's", () => {
    // 9:30 PM in Chicago on Sep 16 is already Sep 17 in UTC.
    const instant = new Date("2026-09-17T02:30:00Z");
    expect(todayInTimeZone("America/Chicago", instant)).toBe("2026-09-16");
    expect(todayInTimeZone("UTC", instant)).toBe("2026-09-17");
    expect(todayInTimeZone(null, instant)).toBe("2026-09-17");
    expect(todayInTimeZone("Pacific/Auckland", instant)).toBe("2026-09-17");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-09-16", 14)).toBe("2026-09-30");
    expect(addDays("2026-12-25", 14)).toBe("2027-01-08");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    // Daylight saving changes don't shift calendar math.
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  });

  it("describes due dates relative to today", () => {
    expect(describeDueDate("2026-09-16", "2026-09-16")).toBe("Due today");
    expect(describeDueDate("2026-09-17", "2026-09-16")).toBe("Due tomorrow");
    expect(describeDueDate("2026-09-21", "2026-09-16")).toBe("Due in 5 days");
    expect(describeDueDate("2026-10-30", "2026-09-16")).toBe("Due Oct 30");
    expect(describeDueDate("2026-09-15", "2026-09-16")).toBe("1 day overdue");
    expect(describeDueDate("2026-09-04", "2026-09-16")).toBe("12 days overdue");
  });

  it("flags overdue loans only after the due date", () => {
    expect(isOverdue("2026-09-15", "2026-09-16")).toBe(true);
    expect(isOverdue("2026-09-16", "2026-09-16")).toBe(false);
    expect(isOverdue(null, "2026-09-16")).toBe(false);
    expect(daysBetween("2026-09-16", "2026-09-01")).toBe(-15);
  });

  it("formats dates and school years", () => {
    expect(formatCalendarDate("2026-09-30", "2026-09-16")).toBe("Sep 30");
    expect(formatCalendarDate("2025-06-02", "2026-09-16")).toBe("Jun 2, 2025");
    expect(schoolYearLabel("2026-09-16")).toBe("2026–27");
    expect(schoolYearLabel("2027-03-01")).toBe("2026–27");
    expect(schoolYearLabel("2027-07-01")).toBe("2027–28");
  });

  it("reads the clock and recent times in the teacher's time zone", () => {
    const instant = new Date("2026-09-17T02:30:00Z");
    expect(hourInTimeZone("America/Chicago", instant)).toBe(21);
    expect(hourInTimeZone("UTC", instant)).toBe(2);
    expect(hourInTimeZone("Pacific/Auckland", new Date("2026-09-17T11:05:00Z"))).toBe(23);

    expect(formatRecentInstant(instant, "America/Chicago", "2026-09-16")).toBe("9:30 PM");
    expect(formatRecentInstant(instant, "America/Chicago", "2026-09-17")).toBe("Yesterday");
    expect(formatRecentInstant(instant, "America/Chicago", "2026-09-25")).toBe("Sep 16");
  });
});
