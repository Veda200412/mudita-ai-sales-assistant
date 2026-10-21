import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";

export class CalendarDatabaseError extends Error {
  constructor() {
    super("Calendar integration data could not be saved or loaded.");
    this.name = "CalendarDatabaseError";
  }
}

function fail(operation: string, code?: string): never {
  console.error("[calendar] Database operation failed", {
    operation,
    code: code ?? "unknown",
  });
  throw new CalendarDatabaseError();
}

function metadataObject(value: Json | null): Record<string, Json | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};
}

export function createCalendarRepository(
  client: SupabaseClient<Database>,
) {
  return {
    async saveState(stateHash: string, userId: string, expiresAt: string) {
      const { error } = await client.from("action_logs").insert({
        actor_user_id: userId,
        action_type: "calendar_oauth_state",
        summary: "Temporary Google Calendar authorization state.",
        metadata: { stateHash, expiresAt },
      });
      if (error) fail("save_oauth_state", error.code);
    },
    async consumeState(stateHash: string) {
      const { data, error } = await client
        .from("action_logs")
        .select("id,actor_user_id,metadata")
        .eq("action_type", "calendar_oauth_state")
        .contains("metadata", { stateHash })
        .maybeSingle();
      if (error) fail("find_oauth_state", error.code);
      if (!data) return null;
      const { error: deleteError } = await client
        .from("action_logs")
        .delete()
        .eq("id", data.id);
      if (deleteError) fail("consume_oauth_state", deleteError.code);
      const metadata = metadataObject(data.metadata);
      if (
        !data.actor_user_id ||
        typeof metadata.expiresAt !== "string" ||
        Date.parse(metadata.expiresAt) <= Date.now()
      ) {
        return null;
      }
      return { userId: data.actor_user_id };
    },
    async saveCredentials(encryptedCredentials: Json, actorUserId: string) {
      const { error } = await client.from("action_logs").insert({
        actor_user_id: actorUserId,
        action_type: "calendar_credentials",
        summary: "Encrypted Google Calendar OAuth credentials.",
        metadata: { encryptedCredentials },
      });
      if (error) fail("save_credentials", error.code);
    },
    async getCredentials() {
      const { data, error } = await client
        .from("action_logs")
        .select("actor_user_id,metadata")
        .eq("action_type", "calendar_credentials")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail("load_credentials", error.code);
      if (!data) return null;
      const metadata = metadataObject(data.metadata);
      return {
        actorUserId: data.actor_user_id,
        encryptedCredentials: metadata.encryptedCredentials,
      };
    },
    async findRepresentative(userId: string) {
      const { data, error } = await client
        .from("sales_representatives")
        .select("id")
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle();
      if (error) fail("find_representative", error.code);
      return data?.id ?? null;
    },
    async findExistingBooking(idempotencyKey: string) {
      const { data, error } = await client
        .from("meetings")
        .select("id,lead_id,representative_id,status,starts_at,ends_at,external_event_id")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (error) fail("find_booking", error.code);
      return data;
    },
    async findMeeting(id: string) {
      const { data, error } = await client
        .from("meetings")
        .select("id,lead_id,representative_id,status,starts_at,ends_at,external_event_id,idempotency_key")
        .eq("id", id)
        .maybeSingle();
      if (error) fail("find_meeting", error.code);
      return data;
    },
    async findLead(leadId: string) {
      const { data, error } = await client
        .from("leads")
        .select("id,full_name,email,status")
        .eq("id", leadId)
        .maybeSingle();
      if (error) fail("find_lead", error.code);
      return data;
    },
    async findPendingBooking(leadId: string, startsAt: string) {
      const { data, error } = await client
        .from("meetings")
        .select("id,lead_id,representative_id,status,starts_at,ends_at,external_event_id")
        .eq("lead_id", leadId)
        .eq("starts_at", startsAt)
        .eq("status", "pending_confirmation")
        .maybeSingle();
      if (error) fail("find_pending_booking", error.code);
      return data;
    },
    async createPendingBooking(input: {
      leadId: string;
      representativeId: string;
      startsAt: string;
      endsAt: string;
      idempotencyKey: string;
    }) {
      const { data, error } = await client
        .from("meetings")
        .insert({
          lead_id: input.leadId,
          representative_id: input.representativeId,
          starts_at: input.startsAt,
          ends_at: input.endsAt,
          status: "pending_confirmation",
          idempotency_key: input.idempotencyKey,
        })
        .select("id,lead_id,status,starts_at,ends_at,external_event_id")
        .single();
      if (error) fail("create_pending_booking", error.code);
      return data;
    },
    async confirmBooking(
      id: string,
      input: { externalEventId: string; customerConfirmedAt: string },
    ) {
      const { error } = await client
        .from("meetings")
        .update({
          status: "confirmed",
          external_event_id: input.externalEventId,
          customer_confirmed_at: input.customerConfirmedAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", "pending_confirmation");
      if (error) fail("confirm_booking", error.code);
    },
    async completeBooking(input: {
      leadId: string;
      actorUserId: string;
      meetingId: string;
      externalEventId: string;
      startsAt: string;
      endsAt: string;
    }) {
      const { error: leadError } = await client
        .from("leads")
        .update({
          status: "meeting_booked",
          updated_at: new Date().toISOString(),
        })
        .eq("id", input.leadId);
      if (leadError) fail("mark_lead_meeting_booked", leadError.code);
      const { data: existing, error: lookupError } = await client
        .from("action_logs")
        .select("id")
        .eq("action_type", "calendar_booking_confirmed")
        .contains("metadata", { meetingId: input.meetingId })
        .maybeSingle();
      if (lookupError) fail("find_booking_action", lookupError.code);
      if (existing) return;
      const { error } = await client.from("action_logs").insert({
        lead_id: input.leadId,
        actor_user_id: input.actorUserId,
        action_type: "calendar_booking_confirmed",
        summary: "Customer-confirmed meeting booked in Google Calendar.",
        metadata: {
          meetingId: input.meetingId,
          externalEventId: input.externalEventId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
        },
      });
      if (error) fail("record_booking_action", error.code);
    },
    async recordAction(input: {
      leadId: string | null;
      actorUserId: string;
      actionType: string;
      summary: string;
      metadata: Json;
    }) {
      const meetingId =
        typeof input.metadata === "object" &&
        input.metadata !== null &&
        !Array.isArray(input.metadata) &&
        typeof input.metadata.meetingId === "string"
          ? input.metadata.meetingId
          : null;
      if (meetingId) {
        const { data: existing, error: lookupError } = await client
          .from("action_logs")
          .select("id")
          .eq("action_type", input.actionType)
          .contains("metadata", { meetingId })
          .maybeSingle();
        if (lookupError) fail("find_booking_action", lookupError.code);
        if (existing) return;
      }
      const { error } = await client.from("action_logs").insert({
        lead_id: input.leadId,
        actor_user_id: input.actorUserId,
        action_type: input.actionType,
        summary: input.summary,
        metadata: input.metadata,
      });
      if (error) fail("record_action", error.code);
    },
  };
}
