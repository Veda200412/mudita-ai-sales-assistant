import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import {
  LeadPersistenceError,
  type LeadPersistenceRepository,
} from "@/lib/lead-persistence";
import { createRepresentativeAssignmentRepository } from "@/lib/supabase/representative-assignment-repository";

function raiseDatabaseFailure(
  operation: string,
  code: string | undefined,
): never {
  console.error("[lead-persistence] Database operation failed", {
    operation,
    code: code ?? "unknown",
  });
  throw new LeadPersistenceError(
    "database_failure",
    "The inquiry could not be saved. Please try again.",
    code,
  );
}

export function createLeadPersistenceRepository(
  client: SupabaseClient<Database>,
): LeadPersistenceRepository {
  const assignmentRepository = createRepresentativeAssignmentRepository(client);
  return {
    async findMessage(channel, idempotencyKey) {
      const { data, error } = await client
        .from("messages")
        .select("lead_id")
        .eq("channel", channel)
        .eq("provider_message_id", idempotencyKey)
        .maybeSingle();
      if (error) raiseDatabaseFailure("find_message", error.code);
      return data ? { leadId: data.lead_id } : null;
    },

    async findLead(leadId) {
      const { data, error } = await client
        .from("leads")
        .select("id,status")
        .eq("id", leadId)
        .maybeSingle();
      if (error) raiseDatabaseFailure("find_lead", error.code);
      return data ? { id: data.id, status: data.status } : null;
    },

    async insertLead(input) {
      const { data, error } = await client
        .from("leads")
        .insert({
          full_name: input.fullName,
          email: input.email,
          company: input.company,
          channel: input.channel,
          status: input.status,
          qualification_evidence: input.qualificationEvidence,
          last_activity_at: input.lastActivityAt,
        })
        .select("id,status")
        .single();
      if (error) raiseDatabaseFailure("insert_lead", error.code);
      return { id: data.id, status: data.status };
    },

    async insertInboundMessage(input) {
      const { error } = await client.from("messages").insert({
        lead_id: input.leadId,
        channel: input.channel,
        direction: "inbound",
        body: input.body,
        provider_message_id: input.idempotencyKey,
        sent_at: input.sentAt,
      });
      if (error) raiseDatabaseFailure("insert_message", error.code);
    },

    async deleteLead(leadId) {
      const { error } = await client.from("leads").delete().eq("id", leadId);
      if (error) raiseDatabaseFailure("delete_incomplete_lead", error.code);
    },

    async ensureActionLog(input) {
      const { data: existing, error: lookupError } = await client
        .from("action_logs")
        .select("id")
        .eq("lead_id", input.leadId)
        .eq("action_type", "lead_inquiry_saved")
        .contains("metadata", { idempotencyKey: input.idempotencyKey })
        .maybeSingle();
      if (lookupError) {
        console.error("[lead-persistence] Action-log lookup failed", {
          operation: "find_action_log",
          code: lookupError.code ?? "unknown",
        });
        return false;
      }
      if (existing) return true;

      const { error: insertError } = await client.from("action_logs").insert({
        lead_id: input.leadId,
        actor_user_id: input.actorUserId,
        action_type: "lead_inquiry_saved",
        summary: "Customer inquiry received and assessed.",
        metadata: {
          idempotencyKey: input.idempotencyKey,
          channel: input.channel,
          leadStatus: input.status,
        },
      });
      if (insertError) {
        console.error("[lead-persistence] Action-log insert failed", {
          operation: "insert_action_log",
          code: insertError.code ?? "unknown",
        });
        return false;
      }
      return true;
    },

    async assignQualifiedLead(input) {
      await assignmentRepository.assign(
        input.leadId,
        input.actorUserId,
        input.channel,
      );
    },
  };
}
