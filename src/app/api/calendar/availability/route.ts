import { NextResponse } from "next/server";
import { CalendarApiError } from "@/lib/calendar/google-api";
import {
  availableSlotStarts,
  getCalendarId,
  loadCalendarTokens,
  localDateRange,
} from "@/lib/calendar/service";
import {
  AuthorizationError,
  authorizeActiveRepresentative,
} from "@/lib/supabase/authorization";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { userId } = await authorizeActiveRepresentative(request);
    const date = new URL(request.url).searchParams.get("date") ?? "";
    const range = localDateRange(date);
    const { tokens } = await loadCalendarTokens(userId);
    const slots = await availableSlotStarts(tokens, getCalendarId(), date);
    return NextResponse.json({
      date,
      timeZone: "Asia/Kolkata",
      workingHours: { start: range.start, end: range.end },
      slots,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof CalendarApiError) {
      return NextResponse.json({ error: error.message }, {
        status: error.status === 429 ? 429 : 502,
      });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message.includes("Set GOOGLE_CALENDAR_ID")
            ? error.message
            : error instanceof Error && error.message.includes("available")
              ? error.message
              : "Calendar availability could not be checked.",
      },
      { status: 503 },
    );
  }
}
