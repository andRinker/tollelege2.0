/** Calendar-date helpers. Due dates are plain YYYY-MM-DD strings in the teacher's time zone. */

export function todayInTimeZone(timeZone: string | null | undefined, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export function isOverdue(dueOn: string | null, today: string): boolean {
  return dueOn !== null && dueOn < today;
}

/** "Sep 30", or "Sep 30, 2025" when the year differs from the reference date's year. */
export function formatCalendarDate(isoDate: string, referenceIsoDate?: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  const sameYear = referenceIsoDate ? referenceIsoDate.slice(0, 4) === isoDate.slice(0, 4) : true;
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Formats an instant as a calendar date in the teacher's time zone. */
export function formatInstant(instant: Date, timeZone: string | null | undefined, referenceIsoDate?: string): string {
  return formatCalendarDate(todayInTimeZone(timeZone, instant), referenceIsoDate);
}

/** "Due today", "Due tomorrow", "Due in 5 days", "1 day overdue", "12 days overdue". */
export function describeDueDate(dueOn: string, today: string): string {
  const days = daysBetween(today, dueOn);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days > 1) return days <= 14 ? `Due in ${days} days` : `Due ${formatCalendarDate(dueOn, today)}`;
  const late = -days;
  return `${late} ${late === 1 ? "day" : "days"} overdue`;
}

export function schoolYearLabel(today: string): string {
  const [year, month] = today.split("-").map(Number);
  // School years start in July.
  const start = month >= 7 ? year : year - 1;
  return `${start}–${String((start + 1) % 100).padStart(2, "0")}`;
}
