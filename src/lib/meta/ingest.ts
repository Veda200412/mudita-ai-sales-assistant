import type { FactExtractor, QualificationResponse } from "@/lib/qualification";
import { runLeadQualification } from "@/lib/qualification";
import type { Json } from "@/lib/types";
import type { LeadChannel, LeadStatus } from "@/lib/types/lead";
import type { MetaInboundMessage } from "@/lib/meta/webhook";

export interface MetaInboundRepository {
  findMessage(
    channel: "instagram" | "whatsapp",
    providerMessageId: string,
  ): Promise<{ leadId: string } | null>;
  findThread(
    channel: "instagram" | "whatsapp",
    threadId: string,
  ): Promise<{ leadId: string } | null>;
  getLead(leadId: string): Promise<{
    id: string;
    status: LeadStatus;
    fullName: string | null;
    email: string | null;
  } | null>;
  insertLead(input: {
    channel: "instagram" | "whatsapp";
    fullName: string | null;
    status: LeadStatus;
    qualificationEvidence: Json;
    lastActivityAt: string;
  }): Promise<{ id: string }>;
  updateLead(input: {
    leadId: string;
    fullName: string | null;
    status: LeadStatus;
    qualificationEvidence: Json;
    lastActivityAt: string;
  }): Promise<void>;
  insertMessage(input: MetaInboundMessage & { leadId: string }): Promise<void>;
  deleteMessage(channel: "instagram" | "whatsapp", id: string): Promise<void>;
  deleteLead(leadId: string): Promise<void>;
  recordProcessed(input: {
    leadId: string;
    channel: "instagram" | "whatsapp";
    providerMessageId: string;
    threadId: string;
    senderId: string;
  }): Promise<void>;
  assignQualifiedLead(input: {
    leadId: string;
    channel: LeadChannel;
  }): Promise<void>;
}

function toLeadStatus(status: QualificationResponse["finalStatus"]): LeadStatus {
  switch (status) {
    case "qualified":
      return "qualified";
    case "not_qualified":
      return "disqualified";
    case "needs_more_information":
      return "follow_up";
  }
}

function toEvidence(result: QualificationResponse): Json {
  return {
    extractedFacts: result.extractedFacts,
    finalStatus: result.finalStatus,
    reason: result.reason,
    evidence: result.evidence,
    missingInformation: [...result.missingInformation],
  };
}

function noTextQualification(): QualificationResponse {
  return {
    extractedFacts: {
      requestedService: null,
      budgetInr: null,
      businessUseCase: null,
      genuineBusinessUseCase: null,
    },
    finalStatus: "needs_more_information",
    reason: "required_information_missing",
    evidence: {
      service: null,
      budgetInr: null,
      businessUseCase: null,
      genuineBusinessUseCase: null,
    },
    missingInformation: [
      "service",
      "businessUseCase",
      "genuineBusinessUseCase",
      "budgetInr",
    ],
  };
}

export class MetaInboundPersistenceError extends Error {
  constructor() {
    super("Inbound Meta messages could not be fully persisted. Meta may retry the webhook.");
    this.name = "MetaInboundPersistenceError";
  }
}

export async function ingestMetaMessages(input: {
  messages: MetaInboundMessage[];
  repository: MetaInboundRepository;
  apiKey: string | undefined;
  extractFacts: FactExtractor;
}): Promise<{ received: number; imported: number; duplicates: number }> {
  let imported = 0;
  let duplicates = 0;
  for (const message of input.messages) {
    const existing = await input.repository.findMessage(message.channel, message.id);
    if (existing) {
      const existingLead = await input.repository.getLead(existing.leadId);
      if (existingLead?.status === "qualified") {
        await input.repository.assignQualifiedLead({
          leadId: existing.leadId,
          channel: message.channel,
        });
      }
      duplicates += 1;
      continue;
    }
    const thread = await input.repository.findThread(message.channel, message.threadId);
    const threadLead = thread
      ? await input.repository.getLead(thread.leadId)
      : null;
    const qualification = !message.hasText
      ? noTextQualification()
      : await runLeadQualification(
          { inquiry: message.body },
          input.apiKey,
          input.extractFacts,
        );
    const status = toLeadStatus(qualification.finalStatus);
    const qualificationEvidence = toEvidence(qualification);
    const isNewLead = !threadLead;
    let leadId: string | null = null;
    let messageInserted = false;
    try {
      if (threadLead) {
        leadId = threadLead.id;
      } else {
        const lead = await input.repository.insertLead({
          channel: message.channel,
          fullName: message.senderName,
          status,
          qualificationEvidence,
          lastActivityAt: message.sentAt,
        });
        leadId = lead.id;
      }
      await input.repository.insertMessage({ ...message, leadId });
      messageInserted = true;
      if (threadLead) {
        await input.repository.updateLead({
          leadId,
          fullName: threadLead.fullName ?? message.senderName,
          status,
          qualificationEvidence,
          lastActivityAt: message.sentAt,
        });
      }
      await input.repository.recordProcessed({
        leadId,
        channel: message.channel,
        providerMessageId: message.id,
        threadId: message.threadId,
        senderId: message.senderId,
      });
      imported += 1;
    } catch (error) {
      if (messageInserted) {
        try {
          await input.repository.deleteMessage(message.channel, message.id);
        } catch {
          console.error("[meta-webhook] Message rollback failed");
        }
      }
      if (isNewLead && leadId) {
        try {
          await input.repository.deleteLead(leadId);
        } catch {
          console.error("[meta-webhook] Lead rollback failed");
        }
      }
      if (error instanceof MetaInboundPersistenceError) throw error;
      throw new MetaInboundPersistenceError();
    }
    if (status === "qualified") {
      await input.repository.assignQualifiedLead({
        leadId,
        channel: message.channel,
      });
    }
  }
  return {
    received: input.messages.length,
    imported,
    duplicates,
  };
}
