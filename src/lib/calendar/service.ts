import "server-only";

import { encryptCalendarTokens, decryptCalendarTokens } from "@/lib/calendar/crypto";
import {
  getBusyRanges,
  refreshCalendarTokens,
  type CalendarTokens,
} from "@/lib/calendar/google-api";
import {
  dailySlotStarts,
  filterAvailableSlotStarts,
  localDateRange,
} from "@/lib/calendar/policy";
import { createCalendarRepository } from "@/lib/calendar/repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export { calendarTimeZone, dailySlotStarts, localDateRange } from "@/lib/calendar/policy";

export function getCalendarId(): string {
  const calendarId = process.env.GOOGLE_CALENDAR_ID?.trim();
  if (!calendarId) {
    throw new Error("Set GOOGLE_CALENDAR_ID to the calendar used for booking.");
  }
  return calendarId;
}

export async function loadCalendarTokens(actorUserId: string): Promise<{
  tokens: CalendarTokens;
  repository: ReturnType<typeof createCalendarRepository>;
}> {
  const repository = createCalendarRepository(createSupabaseAdminClient());
  const stored = await repository.getCredentials();
  if (!stored?.encryptedCredentials) {
    throw new Error("Connect Google Calendar before checking availability.");
  }
  let tokens = decryptCalendarTokens(stored.encryptedCredentials);
  if (tokens.expiresAt <= Date.now() + 60_000) {
    tokens = await refreshCalendarTokens(tokens.refreshToken);
    await repository.saveCredentials(encryptCalendarTokens(tokens), actorUserId);
  }
  return { tokens, repository };
}

export async function availableSlotStarts(
  tokens: CalendarTokens,
  calendarId: string,
  date: string,
): Promise<string[]> {
  const slots = dailySlotStarts(date);
  if (slots.length === 0) return [];
  const range = localDateRange(date);
  const busy = await getBusyRanges(tokens, calendarId, range.start, range.end);
  return filterAvailableSlotStarts(slots, busy);
}
