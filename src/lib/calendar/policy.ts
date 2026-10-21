export const calendarTimeZone = "Asia/Kolkata";

export function localDateRange(
  date: string,
): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Use a valid date.");
  }
  const parsed = new Date(`${date}T12:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new Error("Use a valid date.");
  }
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: calendarTimeZone,
    weekday: "short",
  }).format(parsed);
  if (weekday === "Sat" || weekday === "Sun") {
    throw new Error("Bookings are available Monday through Friday only.");
  }
  return {
    start: `${date}T10:00:00+05:30`,
    end: `${date}T18:00:00+05:30`,
  };
}

export function dailySlotStarts(date: string, now = Date.now()): string[] {
  const range = localDateRange(date);
  const first = Date.parse(range.start);
  const last = Date.parse(range.end);
  const slots: string[] = [];
  for (let start = first; start + 30 * 60_000 <= last; start += 30 * 60_000) {
    if (start > now + 15 * 60_000) slots.push(new Date(start).toISOString());
  }
  return slots;
}

export function filterAvailableSlotStarts(
  slots: string[],
  busy: Array<{ start: string; end: string }>,
): string[] {
  return slots.filter((slot) => {
    const start = Date.parse(slot);
    const end = start + 30 * 60_000;
    return !busy.some(
      (block) =>
        Date.parse(block.start) < end && Date.parse(block.end) > start,
    );
  });
}
