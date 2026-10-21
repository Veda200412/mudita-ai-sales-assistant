import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { LeadChannel } from "@/lib/types/lead";
import type { MetaInboundRepository } from "@/lib/meta/ingest";
import { createRepresentativeAssignmentRepository } from "@/lib/supabase/representative-assignment-repository";

export class MetaWebhookDatabaseError extends Error {
  constructor() {
    super("Meta webhook data could not be saved or loaded.");
    this.name = "MetaWebhookDatabaseError";
  }
}

function fail(operation: string, code?: string): never {
  console.error("[meta-webhook] Database operation failed", {
    operation,
    code: code ?? "unknown",
  });
  throw new MetaWebhookDatabaseError();
}

function messageActionType(channel: "instagram" | "whatsapp") {
  return `${channel}_message_synced`;
}

export function createMetaWebhookRepository(
  client: SupabaseClient<Database>,
) {
  const assignmentRepository = createRepresentativeAssignmentRepository(client);
  const repository: MetaInboundRepository = {
    async findMessage(channel, providerMessageId) {
      const { data, error } = await client
        .from("messages")
        .select("lead_id")
        .eq("channel", channel)
        .eq("provider_message_id", providerMessageId)
        .maybeSingle();
      if (error) fail("find_message", error.code);
      return data ? { leadId: data.lead_id } : null;
    },
    async findThread(channel, threadId) {
      const { data, error } = await client
        .from("action_logs")
        .select("lead_id")
        .eq("action_type", messageActionType(channel))
        .contains("metadata", { threadId })
        .not("lead_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail("find_thread", error.code);
      return data?.lead_id ? { leadId: data.lead_id } : null;
    },
    async getLead(leadId) {
      const { data, error } = await client
        .from("leads")
        .select("id,status,full_name,email")
        .eq("id", leadId)
        .maybeSingle();
      if (error) fail("load_lead", error.code);
      return data
        ? {
            id: data.id,
            status: data.status,
            fullName: data.full_name,
            email: data.email,
          }
        : null;
    },
    async insertLead(input) {
      const { data, error } = await client
        .from("leads")
        .insert({
          channel: input.channel,
          full_name: input.fullName,
          status: input.status,
          qualification_evidence: input.qualificationEvidence,
          last_activity_at: input.lastActivityAt,
        })
        .select("id")
        .single();
      if (error) fail("insert_lead", error.code);
      return { id: data.id };
    },
    async updateLead(input) {
      const { error } = await client
        .from("leads")
        .update({
          full_name: input.fullName,
          status: input.status,
          qualification_evidence: input.qualificationEvidence,
          last_activity_at: input.lastActivityAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", input.leadId);
      if (error) fail("update_lead", error.code);
    },
    async insertMessage(input) {
      const { error } = await client.from("messages").insert({
        lead_id: input.leadId,
        channel: input.channel,
        direction: "inbound",
        body: input.body,
        provider_message_id: input.id,
        sent_at: input.sentAt,
      });
      if (error) fail("insert_message", error.code);
    },
    async deleteMessage(channel, id) {
      const { error } = await client
        .from("messages")
        .delete()
        .eq("channel", channel)
        .eq("provider_message_id", id);
      if (error) fail("rollback_message", error.code);
    },
    async deleteLead(leadId) {
      const { error } = await client.from("leads").delete().eq("id", leadId);
      if (error) fail("rollback_lead", error.code);
    },
    async recordProcessed(input) {
      const actionType = messageActionType(input.channel);
      const { data: existing, error: lookupError } = await client
        .from("action_logs")
        .select("id")
        .eq("action_type", actionType)
        .contains("metadata", { providerMessageId: input.providerMessageId })
        .limit(1)
        .maybeSingle();
      if (lookupError) fail("find_processed_marker", lookupError.code);
      if (existing) return;
      const { error } = await client.from("action_logs").insert({
        lead_id: input.leadId,
        actor_user_id: null,
        action_type: actionType,
        summary:
          input.channel === "instagram"
            ? "Inbound Instagram message received."
            : "Inbound WhatsApp message received.",
        metadata: {
          providerMessageId: input.providerMessageId,
          threadId: input.threadId,
          senderId: input.senderId,
          channel: input.channel,
        },
      });
      if (error) fail("record_processed_marker", error.code);
    },
    async assignQualifiedLead(input) {
      await assignmentRepository.assign(input.leadId, null, input.channel);
    },
  };
  return repository;
}

export function isMetaLeadChannel(value: LeadChannel): value is "instagram" | "whatsapp" {
  return value === "instagram" || value === "whatsapp";
}
