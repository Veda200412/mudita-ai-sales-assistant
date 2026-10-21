import {
  isAutomatedActionAllowed,
  type AutomationControlState,
} from "@/lib/automation-controls";
import {
  routeQualifiedInquiry,
  type RepresentativeAvailability,
  type SupportedServiceId,
} from "@/lib/policy";
import { insightAnalyticsPolicy } from "@/lib/policy-config";
import type { LeadChannel } from "@/lib/types/lead";

export type AssignmentOutcome =
  | { status: "assigned"; representativeId: string; usedFallback: boolean }
  | {
      status: "unassigned";
      reason:
        | "takeover_active"
        | "availability_unconfirmed"
        | "no_available_representative"
        | "representative_not_active"
        | "lead_already_assigned"
        | "unsupported_service";
      checkingRepresentativeId?: string;
    };

export interface RepresentativeAssignmentRepository {
  getLead(leadId: string): Promise<{
    status: string;
    assignedRepresentativeId: string | null;
    serviceId: string | null;
  } | null>;
  getControls(leadId: string, channel: LeadChannel): Promise<AutomationControlState[]>;
  findActiveRepresentative(
    representativeId: "asha" | "rahul",
  ): Promise<{ id: string } | null>;
  assignLead(leadId: string, representativeId: string): Promise<boolean>;
  unassignLead(leadId: string, representativeId: string): Promise<void>;
  recordOutcome(input: {
    leadId: string;
    actorUserId: string | null;
    serviceId: SupportedServiceId | null;
    outcome: AssignmentOutcome;
  }): Promise<void>;
}

export type RepresentativeAvailabilitySource = () => Promise<{
  verified: boolean;
  availability: RepresentativeAvailability;
}>;

export async function runAuthorizedRepresentativeAction<T>(
  request: Request,
  authorize: (request: Request) => Promise<{ userId: string }>,
  action: (actorUserId: string) => Promise<T>,
): Promise<T> {
  const actor = await authorize(request);
  return action(actor.userId);
}

const noVerifiedAvailability: RepresentativeAvailabilitySource = async () => ({
  verified: false,
  availability: {},
});

export async function assignQualifiedLead(input: {
  leadId: string;
  actorUserId: string | null;
  channel: LeadChannel;
  serviceId?: string | null;
  repository: RepresentativeAssignmentRepository;
  availabilitySource?: RepresentativeAvailabilitySource;
}): Promise<AssignmentOutcome | null> {
  const lead = await input.repository.getLead(input.leadId);
  if (!lead || lead.status !== "qualified") return null;
  if (lead.assignedRepresentativeId) {
    return {
      status: "unassigned",
      reason: "lead_already_assigned",
    };
  }
  const serviceId = input.serviceId ?? lead.serviceId;

  const controls = await input.repository.getControls(input.leadId, input.channel);
  if (
    !isAutomatedActionAllowed({
      controls,
      action: "assignment",
      channel: input.channel,
      leadId: input.leadId,
      initiatedBy: "automation",
    })
  ) {
    const outcome: AssignmentOutcome = {
      status: "unassigned",
      reason: "takeover_active",
    };
    await input.repository.recordOutcome({
      leadId: input.leadId,
      actorUserId: input.actorUserId,
      serviceId: isSupportedServiceId(serviceId) ? serviceId : null,
      outcome,
    });
    return outcome;
  }

  if (!isSupportedServiceId(serviceId)) {
    const outcome: AssignmentOutcome = {
      status: "unassigned",
      reason: "unsupported_service",
    };
    await input.repository.recordOutcome({
      leadId: input.leadId,
      actorUserId: input.actorUserId,
      serviceId: null,
      outcome,
    });
    return outcome;
  }

  const availabilityResult = await (
    input.availabilitySource ?? noVerifiedAvailability
  )();
  const routing = routeQualifiedInquiry(
    serviceId,
    availabilityResult.verified ? availabilityResult.availability : {},
    insightAnalyticsPolicy,
  );

  if (routing.status !== "assigned") {
    const outcome: AssignmentOutcome =
      routing.status === "availability_unconfirmed"
        ? {
            status: "unassigned",
            reason: "availability_unconfirmed",
            checkingRepresentativeId: routing.checkingRepresentativeId,
          }
        : { status: "unassigned", reason: "no_available_representative" };
    await input.repository.recordOutcome({
      leadId: input.leadId,
      actorUserId: input.actorUserId,
      serviceId,
      outcome,
    });
    return outcome;
  }

  const representative = await input.repository.findActiveRepresentative(
    routing.representativeId,
  );
  if (!representative) {
    const outcome: AssignmentOutcome = {
      status: "unassigned",
      reason: "representative_not_active",
    };
    await input.repository.recordOutcome({
      leadId: input.leadId,
      actorUserId: input.actorUserId,
      serviceId,
      outcome,
    });
    return outcome;
  }

  if (!(await input.repository.assignLead(input.leadId, representative.id))) {
    const outcome: AssignmentOutcome = {
      status: "unassigned",
      reason: "lead_already_assigned",
    };
    await input.repository.recordOutcome({
      leadId: input.leadId,
      actorUserId: input.actorUserId,
      serviceId,
      outcome,
    });
    return outcome;
  }

  const outcome: AssignmentOutcome = {
    status: "assigned",
    representativeId: representative.id,
    usedFallback: routing.usedFallback,
  };
  try {
    await input.repository.recordOutcome({
      leadId: input.leadId,
      actorUserId: input.actorUserId,
      serviceId,
      outcome,
    });
  } catch (error) {
    try {
      await input.repository.unassignLead(input.leadId, representative.id);
    } catch {
      console.error("[lead-assignment] Failed to roll back unaudited assignment");
    }
    throw error;
  }
  return outcome;
}

function isSupportedServiceId(value: string | null): value is SupportedServiceId {
  return value !== null &&
    insightAnalyticsPolicy.services.some((service) => service.id === value);
}
