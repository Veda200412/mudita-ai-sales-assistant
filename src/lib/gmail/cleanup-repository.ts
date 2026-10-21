import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import type { GmailCleanupLead, GmailCleanupPreviewItem } from "@/lib/gmail/cleanup";
import type { ParsedGmailMessage } from "@/lib/gmail/message-parser";
import { GmailDatabaseError } from "@/lib/gmail/repository";

function metadataObject(value: Json | null): Record<string, Json | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};
}

function fail(operation: string, code?: string): never {
  console.error("[gmail-cleanup] Database operation failed", {
    operation,
    code: code ?? "unknown",
  });
  throw new GmailDatabaseError();
}

function stringValue(
  metadata: Record<string, Json | undefined>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" ? value : null;
}

export function createGmailCleanupRepository(
  client: SupabaseClient<Database>,
) {
  return {
    async loadLeads(
      mailboxEmail: string,
      includeAlreadyIgnored = false,
    ): Promise<GmailCleanupLead[]> {
      const { data: leadRows, error: leadsError } = await client
        .from("leads")
        .select("id,full_name,email")
        .eq("channel", "email")
        .order("created_at", { ascending: true })
        .limit(500);
      if (leadsError) fail("load_email_leads", leadsError.code);
      if (!leadRows?.length) return [];

      const leadIds = leadRows.map((lead) => lead.id);
      const [messageResult, syncedLogResult, ignoredLogResult] =
        await Promise.all([
          client
            .from("messages")
            .select("lead_id,provider_message_id,body,sent_at")
            .eq("channel", "email")
            .in("lead_id", leadIds)
            .order("sent_at", { ascending: true })
            .limit(2000),
          client
            .from("action_logs")
            .select("lead_id,metadata")
            .eq("action_type", "gmail_message_synced")
            .in("lead_id", leadIds)
            .limit(2000),
          client
            .from("action_logs")
            .select("lead_id")
            .eq("action_type", "gmail_cleanup_ignored")
            .contains("metadata", { source: "historical_lead_cleanup" })
            .in("lead_id", leadIds),
        ]);
      const queryError = [
        messageResult.error,
        syncedLogResult.error,
        ignoredLogResult.error,
      ].find(Boolean);
      if (queryError) fail("load_email_history", queryError.code);

      const ignoredLeadIds = new Set(
        (ignoredLogResult.data ?? []).flatMap((row) =>
          row.lead_id ? [row.lead_id] : [],
        ),
      );
      const syncByMessageId = new Map<
        string,
        { leadId: string; metadata: Record<string, Json | undefined> }
      >();
      for (const log of syncedLogResult.data ?? []) {
        if (!log.lead_id) continue;
        const metadata = metadataObject(log.metadata);
        const providerMessageId = stringValue(metadata, "providerMessageId");
        if (providerMessageId) {
          syncByMessageId.set(providerMessageId, {
            leadId: log.lead_id,
            metadata,
          });
        }
      }
      const messagesByLead = new Map<
        string,
        { message: ParsedGmailMessage; complete: boolean }[]
      >();
      const incompleteLeads = new Set<string>();
      for (const message of messageResult.data ?? []) {
        const providerMessageId = message.provider_message_id;
        if (!providerMessageId) {
          incompleteLeads.add(message.lead_id);
          continue;
        }
        const sync = syncByMessageId.get(providerMessageId);
        const threadId = sync ? stringValue(sync.metadata, "threadId") : null;
        const senderEmail = sync
          ? stringValue(sync.metadata, "senderEmail")
          : null;
        const subject = sync ? stringValue(sync.metadata, "subject") : null;
        if (!sync || sync.leadId !== message.lead_id || !threadId || !senderEmail) {
          incompleteLeads.add(message.lead_id);
          continue;
        }
        const parsed: ParsedGmailMessage = {
          id: providerMessageId,
          threadId,
          sender: stringValue(sync.metadata, "sender"),
          senderEmail,
          fromConnectedMailbox:
            senderEmail.toLowerCase() === mailboxEmail.toLowerCase(),
          subject,
          sentAt: message.sent_at,
          body: message.body,
          autoSubmitted: null,
          precedence: null,
          listId: null,
          autoResponseSuppress: null,
        };
        const current = messagesByLead.get(message.lead_id) ?? [];
        current.push({ message: parsed, complete: true });
        messagesByLead.set(message.lead_id, current);
      }

      return leadRows
        .filter(
          (lead) => includeAlreadyIgnored || !ignoredLeadIds.has(lead.id),
        )
        .flatMap((lead) => {
          const entries = messagesByLead.get(lead.id) ?? [];
          return entries.length || incompleteLeads.has(lead.id)
            ? [{
                leadId: lead.id,
                fullName: lead.full_name,
                email: lead.email,
                messageIds: entries.map((entry) => entry.message.id),
                messages: entries.map((entry) => entry.message),
                hasIncompleteHistory: incompleteLeads.has(lead.id),
              }]
            : [];
        });
    },

    async createPreview(
      actorUserId: string,
      items: GmailCleanupPreviewItem[],
    ): Promise<string> {
      const metadata: Json = {
        status: "previewed",
        items: items.map((item) => ({
          leadId: item.leadId,
          category: item.category,
          reasons: item.reasons,
          messageIds: item.messageIds,
        })),
      };
      const { data, error } = await client
        .from("action_logs")
        .insert({
          actor_user_id: actorUserId,
          action_type: "gmail_cleanup_preview",
          summary: "Dry-run preview created for existing Gmail leads.",
          metadata,
        })
        .select("id")
        .single();
      if (error) fail("create_preview", error.code);
      return data.id;
    },

    async getPreview(id: string, actorUserId: string) {
      const { data, error } = await client
        .from("action_logs")
        .select("id,metadata")
        .eq("id", id)
        .eq("actor_user_id", actorUserId)
        .eq("action_type", "gmail_cleanup_preview")
        .maybeSingle();
      if (error) fail("load_preview", error.code);
      if (!data) return null;
      return {
        id: data.id,
        metadata: metadataObject(data.metadata),
      };
    },

    async claimPreview(
      id: string,
      actorUserId: string,
      selectedLeadIds: string[],
    ): Promise<boolean> {
      const preview = await this.getPreview(id, actorUserId);
      if (!preview) return false;
      const updateStatus = async (status: "previewed" | "failed") => {
        const { data, error } = await client
          .from("action_logs")
          .update({
            metadata: {
              ...preview.metadata,
              status: "confirming",
              selectedLeadIds,
            } as Json,
            summary: "Historical Gmail cleanup confirmation is in progress.",
          })
          .eq("id", id)
          .eq("actor_user_id", actorUserId)
          .eq("action_type", "gmail_cleanup_preview")
          .contains("metadata", { status })
          .select("id")
          .maybeSingle();
        if (error) fail("claim_preview", error.code);
        return Boolean(data);
      };
      return (await updateStatus("previewed")) || (await updateStatus("failed"));
    },

    async updatePreviewStatus(
      id: string,
      actorUserId: string,
      status: "failed" | "confirmed",
      selectedLeadIds: string[],
    ): Promise<void> {
      const preview = await this.getPreview(id, actorUserId);
      if (!preview) fail("load_preview_for_status_update");
      const { error } = await client
        .from("action_logs")
        .update({
          metadata: {
            ...preview.metadata,
            status,
            selectedLeadIds,
          } as Json,
          summary:
            status === "confirmed"
              ? "Historical Gmail cleanup confirmation completed."
              : "Historical Gmail cleanup confirmation can be retried.",
        })
        .eq("id", id)
        .eq("actor_user_id", actorUserId)
        .eq("action_type", "gmail_cleanup_preview");
      if (error) fail("update_preview_status", error.code);
    },

    async hasIgnoredMarker(leadId: string): Promise<boolean> {
      const { data, error } = await client
        .from("action_logs")
        .select("id")
        .eq("lead_id", leadId)
        .eq("action_type", "gmail_cleanup_ignored")
        .contains("metadata", { source: "historical_lead_cleanup" })
        .limit(1)
        .maybeSingle();
      if (error) fail("find_ignored_marker", error.code);
      return Boolean(data);
    },

    async recordIgnored(
      actorUserId: string,
      previewId: string,
      item: GmailCleanupPreviewItem,
    ): Promise<void> {
      const { error } = await client.from("action_logs").insert({
        lead_id: item.leadId,
        actor_user_id: actorUserId,
        action_type: "gmail_cleanup_ignored",
        summary: "Existing Gmail lead explicitly marked ignored after review.",
        metadata: {
          source: "historical_lead_cleanup",
          previewId,
          reasons: item.reasons,
          providerMessageIds: item.messageIds,
        },
      });
      if (error) fail("record_ignored_lead", error.code);
    },

    async recordConfirmationSummary(
      actorUserId: string,
      previewId: string,
      leadIds: string[],
    ): Promise<void> {
      const { data: existing, error: lookupError } = await client
        .from("action_logs")
        .select("id")
        .eq("action_type", "gmail_cleanup_confirmed")
        .contains("metadata", { previewId })
        .limit(1)
        .maybeSingle();
      if (lookupError) fail("find_confirmation_summary", lookupError.code);
      if (existing) return;
      const { error } = await client.from("action_logs").insert({
        actor_user_id: actorUserId,
        action_type: "gmail_cleanup_confirmed",
        summary: `Historical Gmail cleanup marked ${leadIds.length} lead(s) as ignored.`,
        metadata: { previewId, ignoredLeadIds: leadIds },
      });
      if (error) fail("record_confirmation_summary", error.code);
    },
  };
}
