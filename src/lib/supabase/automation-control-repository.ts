import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import {
  workspaceControlRows,
  type AutomationChannel,
} from "@/lib/automation-controls";

export const automationChannels: readonly AutomationChannel[] = [
  "email",
  "instagram",
  "whatsapp",
];

export class AutomationControlError extends Error {
  constructor() {
    super("Automation controls could not be saved or loaded.");
    this.name = "AutomationControlError";
  }
}

function fail(operation: string, code?: string): never {
  console.error("[automation-controls] Database operation failed", {
    operation,
    code: code ?? "unknown",
  });
  throw new AutomationControlError();
}

export function createAutomationControlRepository(
  client: SupabaseClient<Database>,
) {
  return {
    async getWorkspaceControls() {
      const { data, error } = await client
        .from("automation_controls")
        .select("lead_id,channel,is_enabled")
        .is("lead_id", null)
        .in("channel", [...automationChannels]);
      if (error) fail("load_workspace_controls", error.code);
      return data ?? [];
    },
    async setWorkspaceTakeover(actorUserId: string, takeover: boolean) {
      const { error } = await client.from("automation_controls").upsert(
        workspaceControlRows(actorUserId, takeover, new Date().toISOString()),
        { onConflict: "lead_id,channel" },
      );
      if (error) fail("save_workspace_controls", error.code);
    },
    async getLeadControls(leadId: string) {
      const { data, error } = await client
        .from("automation_controls")
        .select("lead_id,channel,is_enabled")
        .eq("lead_id", leadId);
      if (error) fail("load_lead_controls", error.code);
      return data ?? [];
    },
    async recordChange(
      actorUserId: string,
      takeover: boolean,
      scope: "workspace" | "lead",
      leadId?: string,
    ) {
      const { error } = await client.from("action_logs").insert({
        actor_user_id: actorUserId,
        lead_id: leadId ?? null,
        action_type: "automation_takeover_changed",
        summary: takeover
          ? "Human takeover enabled; automation paused."
          : "Human takeover disabled; automation resumed.",
        metadata: { scope, leadId: leadId ?? null, takeover },
      });
      if (error) fail("record_change", error.code);
    },
  };
}
