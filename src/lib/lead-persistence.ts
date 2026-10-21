import {
  runLeadQualification,
  validateQualificationRequest,
  type FactExtractor,
  type QualificationResponse,
} from "@/lib/qualification";
import type { Json } from "@/lib/types";
import type { LeadChannel, LeadStatus } from "@/lib/types/lead";

export interface LeadSubmissionRequest {
  inquiry: string;
  channel: LeadChannel;
  fullName?: string;
  email?: string;
  company?: string;
  businessDetails?: {
    service?: string;
    budgetInr?: number;
    businessUseCase?: string;
    genuineBusinessUseCase?: boolean;
  };
}

export interface PersistedLead {
  id: string;
  status: LeadStatus;
}

export interface LeadPersistenceRepository {
  findMessage(
    channel: LeadChannel,
    idempotencyKey: string,
  ): Promise<{ leadId: string } | null>;
  findLead(leadId: string): Promise<PersistedLead | null>;
  insertLead(input: {
    fullName: string | null;
    email: string | null;
    company: string | null;
    channel: LeadChannel;
    status: LeadStatus;
    qualificationEvidence: Json;
    lastActivityAt: string;
  }): Promise<PersistedLead>;
  insertInboundMessage(input: {
    leadId: string;
    channel: LeadChannel;
    body: string;
    idempotencyKey: string;
    sentAt: string;
  }): Promise<void>;
  deleteLead(leadId: string): Promise<void>;
  ensureActionLog(input: {
    leadId: string;
    actorUserId: string;
    idempotencyKey: string;
    channel: LeadChannel;
    status: LeadStatus;
  }): Promise<boolean>;
  assignQualifiedLead?(input: {
    leadId: string;
    actorUserId: string;
    channel: LeadChannel;
  }): Promise<void>;
}

export type LeadPersistenceErrorCode =
  | "invalid_request"
  | "database_failure"
  | "not_found";

export class LeadPersistenceError extends Error {
  constructor(
    public readonly code: LeadPersistenceErrorCode,
    message: string,
    public readonly databaseCode?: string,
  ) {
    super(message);
    this.name = "LeadPersistenceError";
  }
}

const channels = ["instagram", "whatsapp", "email"] as const;
function isLeadChannel(value: string): value is LeadChannel {
  return channels.some((channel) => channel === value);
}

const maxFieldLength = 300;
const idempotencyKeyPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalText(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxFieldLength
  ) {
    throw new LeadPersistenceError(
      "invalid_request",
      `${field} must be a non-empty string of at most ${maxFieldLength} characters.`,
    );
  }
  return value.trim();
}

export function validateLeadSubmission(
  value: unknown,
): LeadSubmissionRequest {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "inquiry",
          "channel",
          "fullName",
          "email",
          "company",
          "businessDetails",
        ].includes(key),
    )
  ) {
    throw new LeadPersistenceError(
      "invalid_request",
      "Provide an inquiry, source channel, and optional lead details.",
    );
  }

  if (
    typeof value.channel !== "string" ||
    !isLeadChannel(value.channel)
  ) {
    throw new LeadPersistenceError(
      "invalid_request",
      "Channel must be instagram, whatsapp, or email.",
    );
  }

  const qualificationRequest = validateQualificationRequest({
    inquiry: value.inquiry,
    ...(value.businessDetails === undefined
      ? {}
      : { businessDetails: value.businessDetails }),
  });
  const fullName = readOptionalText(value.fullName, "Full name");
  const email = readOptionalText(value.email, "Email");
  const company = readOptionalText(value.company, "Company");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new LeadPersistenceError(
      "invalid_request",
      "Email must be a valid email address.",
    );
  }

  return {
    ...qualificationRequest,
    channel: value.channel,
    ...(fullName ? { fullName } : {}),
    ...(email ? { email } : {}),
    ...(company ? { company } : {}),
  };
}

function mapQualificationToLeadStatus(
  status: QualificationResponse["finalStatus"],
): LeadStatus {
  switch (status) {
    case "qualified":
      return "qualified";
    case "not_qualified":
      return "disqualified";
    case "needs_more_information":
      return "follow_up";
  }
}

function validateIdempotencyKey(value: string): void {
  if (!idempotencyKeyPattern.test(value)) {
    throw new LeadPersistenceError(
      "invalid_request",
      "A UUID Idempotency-Key header is required.",
    );
  }
}

export async function qualifyAndPersistLead(
  input: unknown,
  idempotencyKey: string,
  actorUserId: string,
  apiKey: string | undefined,
  extractFacts: FactExtractor,
  repository: LeadPersistenceRepository,
): Promise<{
  lead: PersistedLead;
  qualification: QualificationResponse | null;
  duplicate: boolean;
  actionLogRecorded: boolean;
}> {
  const submission = validateLeadSubmission(input);
  validateIdempotencyKey(idempotencyKey);

  const existingMessage = await repository.findMessage(
    submission.channel,
    idempotencyKey,
  );
  if (existingMessage) {
    const existingLead = await repository.findLead(existingMessage.leadId);
    if (!existingLead) {
      throw new LeadPersistenceError(
        "database_failure",
        "The existing inquiry could not be loaded.",
      );
    }
    const actionLogRecorded = await repository.ensureActionLog({
      leadId: existingLead.id,
      actorUserId,
      idempotencyKey,
      channel: submission.channel,
      status: existingLead.status,
    });
    if (existingLead.status === "qualified") {
      await repository.assignQualifiedLead?.({
        leadId: existingLead.id,
        actorUserId,
        channel: submission.channel,
      });
    }
    return {
      lead: existingLead,
      qualification: null,
      duplicate: true,
      actionLogRecorded,
    };
  }

  const qualification = await runLeadQualification(
    {
      inquiry: submission.inquiry,
      ...(submission.businessDetails
        ? { businessDetails: submission.businessDetails }
        : {}),
    },
    apiKey,
    extractFacts,
  );
  const leadStatus = mapQualificationToLeadStatus(
    qualification.finalStatus,
  );
  const timestamp = new Date().toISOString();
  const qualificationEvidence: Json = {
    extractedFacts: {
      requestedService: qualification.extractedFacts.requestedService,
      budgetInr: qualification.extractedFacts.budgetInr,
      businessUseCase: qualification.extractedFacts.businessUseCase,
      genuineBusinessUseCase:
        qualification.extractedFacts.genuineBusinessUseCase,
    },
    finalStatus: qualification.finalStatus,
    reason: qualification.reason,
    evidence: {
      service: qualification.evidence.service,
      budgetInr: qualification.evidence.budgetInr,
      businessUseCase: qualification.evidence.businessUseCase,
      genuineBusinessUseCase: qualification.evidence.genuineBusinessUseCase,
    },
    missingInformation: [...qualification.missingInformation],
  };
  const lead = await repository.insertLead({
    fullName: submission.fullName ?? null,
    email: submission.email ?? null,
    company: submission.company ?? null,
    channel: submission.channel,
    status: leadStatus,
    qualificationEvidence,
    lastActivityAt: timestamp,
  });

  try {
    await repository.insertInboundMessage({
      leadId: lead.id,
      channel: submission.channel,
      body: submission.inquiry,
      idempotencyKey,
      sentAt: timestamp,
    });
  } catch (error) {
    try {
      await repository.deleteLead(lead.id);
    } catch (cleanupError) {
      const cleanupCode =
        cleanupError instanceof LeadPersistenceError
          ? cleanupError.databaseCode
          : undefined;
      console.error("[lead-persistence] Failed to remove incomplete lead", {
        code: cleanupCode ?? "unknown",
      });
    }

    const databaseCode =
      error instanceof LeadPersistenceError ? error.databaseCode : undefined;
    if (databaseCode === "23505") {
      const concurrentMessage = await repository.findMessage(
        submission.channel,
        idempotencyKey,
      );
      if (concurrentMessage) {
        const concurrentLead = await repository.findLead(
          concurrentMessage.leadId,
        );
        if (concurrentLead) {
          const actionLogRecorded = await repository.ensureActionLog({
            leadId: concurrentLead.id,
            actorUserId,
            idempotencyKey,
            channel: submission.channel,
            status: concurrentLead.status,
          });
          return {
            lead: concurrentLead,
            qualification: null,
            duplicate: true,
            actionLogRecorded,
          };
        }
      }
    }
    if (error instanceof LeadPersistenceError) throw error;
    throw new LeadPersistenceError(
      "database_failure",
      "The inquiry could not be saved. Please try again.",
    );
  }

  const actionLogRecorded = await repository.ensureActionLog({
    leadId: lead.id,
    actorUserId,
    idempotencyKey,
    channel: submission.channel,
    status: leadStatus,
  });
  if (leadStatus === "qualified") {
    await repository.assignQualifiedLead?.({
      leadId: lead.id,
      actorUserId,
      channel: submission.channel,
    });
  }
  return {
    lead,
    qualification,
    duplicate: false,
    actionLogRecorded,
  };
}
