import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  CalendarApiError,
  createCalendarEvent,
  getCalendarEvent,
} from "@/lib/calendar/google-api";
import { createCalendarRepository } from "@/lib/calendar/repository";
import {
  availableSlotStarts,
  calendarTimeZone,
  getCalendarId,
  loadCalendarTokens,
  localDateRange,
} from "@/lib/calendar/service";
import {
  AuthorizationError,
  authorizeActiveRepresentative,
} from "@/lib/supabase/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request) {
  try {
    const { userId } = await authorizeActiveRepresentative(request);
    const body: unknown = await request.json().catch(() => null);
    if (!isRecord(body) || !isUuid(body.bookingId) || body.customerConfirmed !== true) {
      return NextResponse.json(
        { error: "Explicit customer confirmation is required before booking." },
        { status: 400 },
      );
    }
    const client = createSupabaseAdminClient();
    const repository = createCalendarRepository(client);
    const representativeId = await repository.findRepresentative(userId);
    const meeting = await repository.findMeeting(body.bookingId);
    if (!meeting || !representativeId || meeting.representative_id !== representativeId) {
      return NextResponse.json({ error: "Pending booking was not found." }, { status: 404 });
    }
    if (meeting.status === "confirmed" && meeting.external_event_id) {
      await repository.completeBooking({
        leadId: meeting.lead_id,
        actorUserId: userId,
        meetingId: meeting.id,
        externalEventId: meeting.external_event_id,
        startsAt: meeting.starts_at,
        endsAt: meeting.ends_at,
      });
      return NextResponse.json({
        bookingId: meeting.id,
        status: "confirmed",
        duplicate: true,
        eventId: meeting.external_event_id,
      });
    }
    if (meeting.status !== "pending_confirmation") {
      return NextResponse.json(
        { error: "This booking is no longer pending customer confirmation." },
        { status: 409 },
      );
    }

    const date = meeting.starts_at.slice(0, 10);
    const range = localDateRange(date);
    const start = new Date(meeting.starts_at);
    const expectedEnd = new Date(start.getTime() + 30 * 60_000).toISOString();
    if (
      Number.isNaN(start.getTime()) ||
      expectedEnd !== meeting.ends_at ||
      start.toISOString().slice(0, 10) !== date ||
      start.getTime() <= Date.now() ||
      start.getTime() < Date.parse(range.start) ||
      Date.parse(expectedEnd) > Date.parse(range.end)
    ) {
      return NextResponse.json(
        { error: "The requested slot is no longer valid. Create a new booking request." },
        { status: 409 },
      );
    }

    const { tokens } = await loadCalendarTokens(userId);
    const calendarId = getCalendarId();
    const eventId = createHash("sha256")
      .update(`mudita-meeting:${meeting.id}`)
      .digest("hex");
    const priorEvent = await getCalendarEvent(tokens, calendarId, eventId);
    if (!priorEvent) {
      const available = await availableSlotStarts(tokens, calendarId, date);
      if (!available.includes(start.toISOString())) {
        return NextResponse.json(
          { error: "The slot is no longer available. Choose a new time with the customer." },
          { status: 409 },
        );
      }
    }

    const lead = await repository.findLead(meeting.lead_id);
    if (!lead) {
      return NextResponse.json({ error: "The booking's lead could not be found." }, { status: 409 });
    }
    const event = priorEvent ?? await createCalendarEvent(tokens, calendarId, {
      id: eventId,
      summary: `Mudita sales meeting${lead.full_name ? ` — ${lead.full_name}` : ""}`,
      description: [
        "Customer-confirmed sales meeting.",
        lead.email ? `Contact: ${lead.email}` : null,
        `Lead reference: ${lead.id}`,
      ].filter(Boolean).join("\n"),
      start: meeting.starts_at,
      end: meeting.ends_at,
      timeZone: calendarTimeZone,
    });
    await repository.confirmBooking(meeting.id, {
      externalEventId: event.id,
      customerConfirmedAt: new Date().toISOString(),
    });
    await repository.completeBooking({
      leadId: meeting.lead_id,
      actorUserId: userId,
      meetingId: meeting.id,
      externalEventId: event.id,
      startsAt: meeting.starts_at,
      endsAt: meeting.ends_at,
    });
    return NextResponse.json({
      bookingId: meeting.id,
      status: "confirmed",
      duplicate: false,
      eventId: event.id,
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
    console.error("[calendar] Booking confirmation failed");
    return NextResponse.json(
      { error: "Google Calendar booking could not be confirmed." },
      { status: 503 },
    );
  }
}
