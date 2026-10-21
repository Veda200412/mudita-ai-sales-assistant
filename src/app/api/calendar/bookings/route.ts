import { NextResponse } from "next/server";
import { createCalendarRepository } from "@/lib/calendar/repository";
import { CalendarApiError } from "@/lib/calendar/google-api";
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
    const idempotencyKey = request.headers.get("idempotency-key");
    if (
      !isRecord(body) ||
      !isUuid(body.leadId) ||
      typeof body.slotStart !== "string" ||
      !idempotencyKey ||
      !isUuid(idempotencyKey)
    ) {
      return NextResponse.json(
        { error: "Provide a valid lead, available slot, and UUID idempotency key." },
        { status: 400 },
      );
    }
    const startDate = new Date(body.slotStart);
    if (
      Number.isNaN(startDate.getTime()) ||
      startDate.toISOString() !== body.slotStart
    ) {
      return NextResponse.json({ error: "Select a valid calendar slot." }, { status: 400 });
    }
    const client = createSupabaseAdminClient();
    const repository = createCalendarRepository(client);
    const representativeId = await repository.findRepresentative(userId);
    if (!representativeId) {
      return NextResponse.json(
        { error: "An active representative profile is required to request a booking." },
        { status: 403 },
      );
    }
    const existing = await repository.findExistingBooking(idempotencyKey);
    if (existing) {
      if (
        existing.lead_id !== body.leadId ||
        existing.starts_at !== body.slotStart ||
        existing.representative_id !== representativeId
      ) {
        return NextResponse.json(
          { error: "This idempotency key is already used for another booking." },
          { status: 409 },
        );
      }
      await repository.recordAction({
        leadId: existing.lead_id,
        actorUserId: userId,
        actionType: "calendar_booking_pending",
        summary: "Calendar slot held pending customer confirmation.",
        metadata: {
          meetingId: existing.id,
          startsAt: existing.starts_at,
          endsAt: existing.ends_at,
          timeZone: calendarTimeZone,
        },
      });
      return NextResponse.json({ bookingId: existing.id, duplicate: true });
    }
    const lead = await repository.findLead(body.leadId);
    if (!lead) {
      return NextResponse.json({ error: "Lead was not found." }, { status: 404 });
    }
    if (lead.status !== "qualified") {
      return NextResponse.json(
        { error: "Only qualified leads can request a meeting." },
        { status: 409 },
      );
    }
    const pending = await repository.findPendingBooking(body.leadId, body.slotStart);
    if (pending) {
      if (pending.representative_id !== representativeId) {
        return NextResponse.json(
          { error: "That lead and slot already have a pending confirmation." },
          { status: 409 },
        );
      }
      return NextResponse.json({
        bookingId: pending.id,
        duplicate: true,
        status: "pending_confirmation",
      });
    }
    const date = body.slotStart.slice(0, 10);
    const range = localDateRange(date);
    const allowedSlots = await availableSlotStarts(
      (await loadCalendarTokens(userId)).tokens,
      getCalendarId(),
      date,
    );
    if (
      !allowedSlots.includes(body.slotStart) ||
      startDate.getTime() + 30 * 60_000 > Date.parse(range.end)
    ) {
      return NextResponse.json(
        { error: "That slot is no longer available. Refresh availability." },
        { status: 409 },
      );
    }
    const booking = await repository.createPendingBooking({
      leadId: body.leadId,
      representativeId,
      startsAt: body.slotStart,
      endsAt: new Date(startDate.getTime() + 30 * 60_000).toISOString(),
      idempotencyKey,
    });
    await repository.recordAction({
      leadId: lead.id,
      actorUserId: userId,
      actionType: "calendar_booking_pending",
      summary: "Calendar slot held pending customer confirmation.",
      metadata: {
        meetingId: booking.id,
        startsAt: booking.starts_at,
        endsAt: booking.ends_at,
        timeZone: calendarTimeZone,
      },
    });
    return NextResponse.json(
      { bookingId: booking.id, duplicate: false, status: "pending_confirmation" },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof CalendarApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status === 429 ? 429 : 502 });
    }
    console.error("[calendar] Booking request failed");
    return NextResponse.json(
      { error: "Calendar booking request could not be created." },
      { status: 503 },
    );
  }
}
