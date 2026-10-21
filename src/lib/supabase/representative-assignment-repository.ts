import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { insightAnalyticsPolicy } from "@/lib/policy-config";
import type { Database, Json } from "@/lib/supabase/types";
import type { LeadChannel } from "@/lib/types/lead";
import {
  assignQualifiedLead,
  type AssignmentOutcome,
  type RepresentativeAssignmentRepository,
} from "@/lib/representative-assignment";

export class RepresentativeAssignmentError extends Error {
  constructor() {
    super("Qualified lead assignment could not be persisted.");
    this.name = "RepresentativeAssignmentError";
  }
}

function fail(operation: string, code?: string): never {
  console.error("[lead-assignment] Database operation failed", {
    operation,
    code: code ?? "unknown",
  });
  throw new RepresentativeAssignmentError();
}

function getServiceId(evidence: Json): string | null {
  if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence)) {
    return null;
  }
  const facts = evidence.extractedFacts;
  if (typeof facts !== "object" || facts === null || Array.isArray(facts)) {
    return null;
  }
  return typeof facts.requestedService === "string"
    ? facts.requestedService
    : null;
}

function assignmentMetadata(
  serviceId: string | null,
  outcome: AssignmentOutcome,
): Record<string, Json> {
  return {
    serviceId,
    outcome: outcome.status,
    ...(outcome.status === "assigned"
      ? {
          representativeId: outcome.representativeId,
          usedFallback: outcome.usedFallback,
        }
      : {
          reason: outcome.reason,
          ...(outcome.checkingRepresentativeId
            ? { checkingRepresentativeId: outcome.checkingRepresentativeId }
            : {}),
        }),
  };
}

export function createRepresentativeAssignmentRepository(
  client: SupabaseClient<Database>,
) {
  const repository: RepresentativeAssignmentRepository = {
    async getLead(leadId) {
      const { data, error } = await client
        .from("leads")
        .select("status,assigned_representative_id,qualification_evidence")
        .eq("id", leadId)
        .maybeSingle();
      if (error) fail("load_lead", error.code);
      return data
        ? {
            status: data.status,
            assignedRepresentativeId: data.assigned_representative_id,
            serviceId: getServiceId(data.qualification_evidence),
          }
        : null;
    },
    async getControls(leadId, channel) {
      const [workspace, lead] = await Promise.all([
        client
          .from("automation_controls")
          .select("lead_id,channel,is_enabled")
          .is("lead_id", null)
          .eq("channel", channel)
          .maybeSingle(),
        client
          .from("automation_controls")
          .select("lead_id,channel,is_enabled")
          .eq("lead_id", leadId),
      ]);
      if (workspace.error) fail("load_workspace_control", workspace.error.code);
      if (lead.error) fail("load_lead_controls", lead.error.code);
      return [...(workspace.data ? [workspace.data] : []), ...(lead.data ?? [])].map(
        (control) => ({
          leadId: control.lead_id,
          channel: control.channel,
          isEnabled: control.is_enabled,
        }),
      );
    },
    async findActiveRepresentative(representativeId) {
      const configured = insightAnalyticsPolicy.representatives.find(
        (representative) => representative.id === representativeId,
      );
      if (!configured) return null;
      const { data, error } = await client
        .from("sales_representatives")
        .select("id")
        .eq("display_name", configured.name)
        .eq("is_active", true)
        .maybeSingle();
      if (error) fail("find_active_representative", error.code);
      return data ? { id: data.id } : null;
    },
    async assignLead(leadId, representativeId) {
      const { data, error } = await client
        .from("leads")
        .update({
          assigned_representative_id: representativeId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId)
        .eq("status", "qualified")
        .is("assigned_representative_id", null)
        .select("id")
        .maybeSingle();
      if (error) fail("assign_lead", error.code);
      return Boolean(data);
    },
    async unassignLead(leadId, representativeId) {
      const { error } = await client
        .from("leads")
        .update({
          assigned_representative_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId)
        .eq("assigned_representative_id", representativeId);
      if (error) fail("rollback_assignment", error.code);
    },
    async recordOutcome(input) {
      const actionType =
        input.outcome.status === "assigned"
          ? "lead_assigned"
          : "lead_assignment_unassigned";
      const metadata = assignmentMetadata(input.serviceId, input.outcome);
      const { data: existing, error: lookupError } = await client
        .from("action_logs")
        .select("id")
        .eq("lead_id", input.leadId)
        .eq("action_type", actionType)
        .contains("metadata", metadata)
        .limit(1)
        .maybeSingle();
      if (lookupError) fail("find_assignment_log", lookupError.code);
      if (existing) return;
      const summary =
        input.outcome.status === "assigned"
          ? `Lead assigned to ${input.outcome.representativeId}${input.outcome.usedFallback ? " using the configured fallback" : ""}.`
          : assignmentReason(input.outcome);
      const { error } = await client.from("action_logs").insert({
        lead_id: input.leadId,
        actor_user_id: input.actorUserId,
        action_type: actionType,
        summary,
        metadata,
      });
      if (error) fail("record_assignment_outcome", error.code);
    },
  };

  return {
    repository,
    async assign(leadId: string, actorUserId: string | null, channel: LeadChannel) {
      return assignQualifiedLead({
        leadId,
        actorUserId,
        channel,
        repository,
      });
    },
  };
}

function assignmentReason(outcome: Extract<AssignmentOutcome, { status: "unassigned" }>): string {
  switch (outcome.reason) {
    case "takeover_active":
      return "Automated assignment skipped because human takeover is active.";
    case "availability_unconfirmed": {
      const representative = insightAnalyticsPolicy.representatives.find(
        (candidate) => candidate.id === outcome.checkingRepresentativeId,
      );
      return `Lead remains unassigned because availability for ${representative?.name ?? "the routed representative"} is unconfirmed; no verified representative-availability source is configured.`;
    }
    case "no_available_representative":
      return "Lead remains unassigned because the configured representatives are unavailable.";
    case "representative_not_active":
      return "Lead remains unassigned because the routed representative is not active in the workspace.";
    case "lead_already_assigned":
      return "Automated assignment skipped because the lead already has an assignee.";
    case "unsupported_service":
      return "Lead remains unassigned because no supported service could be matched.";
  }
}
