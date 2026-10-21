import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import type { GmailSyncRepository } from "@/lib/gmail/sync";
import { createRepresentativeAssignmentRepository } from "@/lib/supabase/representative-assignment-repository";

export class GmailDatabaseError extends Error {
  constructor() {
    super("Gmail integration data could not be saved or loaded.");
    this.name = "GmailDatabaseError";
  }
}

function fail(operation: string, code?: string): never {
  console.error("[gmail] Database operation failed", {
    operation,
    code: code ?? "unknown",
  });
  throw new GmailDatabaseError();
}

function metadataObject(value: Json | null): Record<string, Json | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};
}

export function createGmailRepository(
  client: SupabaseClient<Database>,
) {
  const assignmentRepository = createRepresentativeAssignmentRepository(client);
  const syncRepository: GmailSyncRepository = {
    async findMessage(providerMessageId) {
      const { data, error } = await client
        .from("messages")
        .select("lead_id")
        .eq("channel", "email")
        .eq("provider_message_id", providerMessageId)
        .maybeSingle();
      if (error) fail("find_message", error.code);
      return data ? { leadId: data.lead_id } : null;
    },
    async findIgnoredMessage(providerMessageId) {
      const { data, error } = await client
        .from("action_logs")
        .select("id")
        .eq("action_type", "gmail_message_ignored")
        .contains("metadata", { providerMessageId })
        .limit(1)
        .maybeSingle();
      if (error) fail("find_ignored_message", error.code);
      return Boolean(data);
    },
    async findThread(threadId) {
      const { data, error } = await client
        .from("action_logs")
        .select("lead_id")
        .eq("action_type", "gmail_message_synced")
        .contains("metadata", { threadId })
        .not("lead_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail("find_thread", error.code);
      return data?.lead_id ? { leadId: data.lead_id } : null;
    },
    async findLead(leadId) {
      const { data, error } = await client
        .from("leads")
        .select("id,status,full_name,email")
        .eq("id", leadId)
        .maybeSingle();
      if (error) fail("find_lead", error.code);
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
          full_name: input.fullName,
          email: input.email,
          channel: "email",
          status: input.status,
          qualification_evidence: input.qualificationEvidence,
          last_activity_at: input.lastActivityAt,
        })
        .select("id,status")
        .single();
      if (error) fail("insert_lead", error.code);
      return { id: data.id, status: data.status };
    },
    async updateLead(leadId, input) {
      const { error } = await client
        .from("leads")
        .update({
          full_name: input.fullName,
          email: input.email,
          status: input.status,
          qualification_evidence: input.qualificationEvidence,
          last_activity_at: input.lastActivityAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId);
      if (error) fail("update_lead", error.code);
    },
    async insertMessage(input) {
      const { error } = await client.from("messages").insert({
        lead_id: input.leadId,
        channel: "email",
        direction: "inbound",
        body: input.body,
        provider_message_id: input.providerMessageId,
        sent_at: input.sentAt,
      });
      if (error) fail("insert_message", error.code);
    },
    async deleteMessage(providerMessageId) {
      const { error } = await client
        .from("messages")
        .delete()
        .eq("channel", "email")
        .eq("provider_message_id", providerMessageId);
      if (error) fail("delete_message", error.code);
    },
    async deleteLead(leadId) {
      const { error } = await client.from("leads").delete().eq("id", leadId);
      if (error) fail("delete_lead", error.code);
    },
    async recordProcessed(input) {
      const { data: existing, error: lookupError } = await client
        .from("action_logs")
        .select("id")
        .eq("action_type", "gmail_message_synced")
        .contains("metadata", { providerMessageId: input.providerMessageId })
        .maybeSingle();
      if (lookupError) fail("find_processed_message", lookupError.code);
      if (existing) return;

      const { error } = await client.from("action_logs").insert({
        lead_id: input.leadId,
        actor_user_id: input.actorUserId,
        action_type: "gmail_message_synced",
        summary: "Inbound email synchronized from Gmail.",
        metadata: {
          providerMessageId: input.providerMessageId,
          threadId: input.threadId,
          sender: input.sender,
          senderEmail: input.senderEmail,
          subject: input.subject,
        },
      });
      if (error) fail("record_processed_message", error.code);
    },
    async recordIgnored(input) {
      const { data: existing, error: lookupError } = await client
        .from("action_logs")
        .select("id")
        .eq("action_type", "gmail_message_ignored")
        .contains("metadata", { providerMessageId: input.providerMessageId })
        .maybeSingle();
      if (lookupError) fail("find_ignored_message", lookupError.code);
      if (existing) return;

      const { error } = await client.from("action_logs").insert({
        actor_user_id: input.actorUserId,
        action_type: "gmail_message_ignored",
        summary: "Gmail message recorded as ignored by inbound sales filters.",
        metadata: {
          providerMessageId: input.providerMessageId,
          threadId: input.threadId,
          reason: input.reason,
        },
      });
      if (error) fail("record_ignored_message", error.code);
    },
    async assignQualifiedLead(input) {
      await assignmentRepository.assign(
        input.leadId,
        input.actorUserId,
        input.channel,
      );
    },
  };

  return {
    syncRepository,
    async saveOAuthState(input: {
      stateHash: string;
      userId: string;
      expiresAt: string;
    }) {
      const { error } = await client.from("action_logs").insert({
        actor_user_id: input.userId,
        action_type: "gmail_oauth_state",
        summary: "Temporary Gmail OAuth authorization state.",
        metadata: {
          stateHash: input.stateHash,
          expiresAt: input.expiresAt,
        },
      });
      if (error) fail("save_oauth_state", error.code);
    },
    async consumeOAuthState(stateHash: string) {
      const { data, error } = await client
        .from("action_logs")
        .select("id,actor_user_id,metadata")
        .eq("action_type", "gmail_oauth_state")
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
      const expiresAt =
        typeof metadata.expiresAt === "string" ? metadata.expiresAt : "";
      if (!data.actor_user_id || Date.parse(expiresAt) <= Date.now()) return null;
      return { userId: data.actor_user_id };
    },
    async saveCredentials(encryptedCredentials: Json, actorUserId: string) {
      const { error } = await client.from("action_logs").insert({
        actor_user_id: actorUserId,
        action_type: "gmail_credentials",
        summary: "Encrypted Gmail OAuth credentials.",
        metadata: { encryptedCredentials },
      });
      if (error) fail("save_credentials", error.code);
    },
    async getCredentials(): Promise<{
      encryptedCredentials: Json;
      actorUserId: string | null;
    } | null> {
      const { data, error } = await client
        .from("action_logs")
        .select("actor_user_id,metadata")
        .eq("action_type", "gmail_credentials")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) fail("load_credentials", error.code);
      if (!data) return null;
      const metadata = metadataObject(data.metadata);
      if (!metadata.encryptedCredentials) fail("validate_credentials");
      return {
        encryptedCredentials: metadata.encryptedCredentials,
        actorUserId: data.actor_user_id,
      };
    },
    async saveConnectionStatus(
      actorUserId: string,
      status: "connected" | "revoked" | "error",
      errorMessage?: string,
    ) {
      const { error } = await client.from("action_logs").insert({
        actor_user_id: actorUserId,
        action_type: "gmail_connection_status",
        summary:
          status === "connected"
            ? "Gmail mailbox connected."
            : status === "revoked"
              ? "Gmail mailbox authorization revoked."
              : "Gmail mailbox connection error.",
        metadata: {
          status,
          ...(errorMessage ? { error: errorMessage } : {}),
        },
      });
      if (error) fail("save_connection_status", error.code);
    },
    async saveSyncStatus(
      actorUserId: string,
      status: "success" | "error",
      details: {
        imported?: number;
        fetched?: number;
        ignored?: number;
        error?: string;
      },
    ) {
      const { error } = await client.from("action_logs").insert({
        actor_user_id: actorUserId,
        action_type: "gmail_sync_status",
        summary:
          status === "success"
            ? "Gmail mailbox sync completed."
            : "Gmail mailbox sync failed.",
        metadata: { status, ...details },
      });
      if (error) fail("save_sync_status", error.code);
    },
    async getStatus() {
      const [credentialResult, connectionResult, syncResult, successResult] =
        await Promise.all([
          client
            .from("action_logs")
            .select("id")
            .eq("action_type", "gmail_credentials")
            .limit(1)
            .maybeSingle(),
          client
            .from("action_logs")
            .select("metadata")
            .eq("action_type", "gmail_connection_status")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          client
            .from("action_logs")
            .select("metadata")
            .eq("action_type", "gmail_sync_status")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          client
            .from("action_logs")
            .select("created_at")
            .eq("action_type", "gmail_sync_status")
            .contains("metadata", { status: "success" })
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
      const failure = [
        credentialResult.error,
        connectionResult.error,
        syncResult.error,
        successResult.error,
      ].find(Boolean);
      if (failure) fail("load_status", failure.code);
      const connection = metadataObject(connectionResult.data?.metadata ?? null);
      const sync = metadataObject(syncResult.data?.metadata ?? null);
      const isConnected =
        Boolean(credentialResult.data) && connection.status !== "revoked";
      const error =
        typeof sync.error === "string"
          ? sync.error
          : typeof connection.error === "string"
            ? connection.error
            : null;
      return {
        connected: isConnected,
        lastSuccessfulSync: successResult.data?.created_at ?? null,
        error,
      };
    },
  };
}

export type GmailRepository = ReturnType<typeof createGmailRepository>;
