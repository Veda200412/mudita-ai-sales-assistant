import {
  runLeadQualification,
  type FactExtractor,
  type QualificationResponse,
} from "@/lib/qualification";
import type { Json } from "@/lib/types";
import type { LeadStatus } from "@/lib/types/lead";
import {
  classifyGmailMessage,
  type GmailIgnoredReason,
} from "@/lib/gmail/classify-message";

export interface GmailInboundMessage {
  id: string;
  threadId: string;
  sender: string | null;
  senderEmail: string | null;
  fromConnectedMailbox: boolean;
  subject: string | null;
  sentAt: string;
  body: string;
  autoSubmitted: string | null;
  precedence: string | null;
  listId: string | null;
  autoResponseSuppress: string | null;
}

export interface GmailSyncRepository {
  findMessage(providerMessageId: string): Promise<{ leadId: string } | null>;
  findIgnoredMessage(providerMessageId: string): Promise<boolean>;
  findThread(threadId: string): Promise<{ leadId: string } | null>;
  findLead(leadId: string): Promise<{
    id: string;
    status: LeadStatus;
    fullName: string | null;
    email: string | null;
  } | null>;
  insertLead(input: {
    fullName: string | null;
    email: string | null;
    status: LeadStatus;
    qualificationEvidence: Json;
    lastActivityAt: string;
  }): Promise<{ id: string; status: LeadStatus }>;
  updateLead(
    leadId: string,
    input: {
      fullName: string | null;
      email: string | null;
      status: LeadStatus;
      qualificationEvidence: Json;
      lastActivityAt: string;
    },
  ): Promise<void>;
  insertMessage(input: {
    leadId: string;
    body: string;
    providerMessageId: string;
    sentAt: string;
  }): Promise<void>;
  deleteMessage(providerMessageId: string): Promise<void>;
  deleteLead(leadId: string): Promise<void>;
  recordProcessed(input: {
    leadId: string;
    actorUserId: string;
    providerMessageId: string;
    threadId: string;
    sender: string | null;
    senderEmail: string | null;
    subject: string | null;
  }): Promise<void>;
  recordIgnored(input: {
    actorUserId: string;
    providerMessageId: string;
    threadId: string;
    reason: GmailIgnoredReason;
  }): Promise<void>;
  assignQualifiedLead?(input: {
    leadId: string;
    actorUserId: string;
    channel: "email";
  }): Promise<void>;
}

const activeSyncs = new Set<string>();

export class GmailSyncError extends Error {
  constructor(
    public readonly code:
      | "gmail_failure"
      | "persistence_failure"
      | "qualification_failure"
      | "sync_in_progress",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "GmailSyncError";
  }
}

function mapStatus(status: QualificationResponse["finalStatus"]): LeadStatus {
  switch (status) {
    case "qualified":
      return "qualified";
    case "not_qualified":
      return "disqualified";
    case "needs_more_information":
      return "follow_up";
  }
}

function makeEvidence(qualification: QualificationResponse): Json {
  return {
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
      genuineBusinessUseCase:
        qualification.evidence.genuineBusinessUseCase,
    },
    missingInformation: [...qualification.missingInformation],
  };
}

export async function syncGmailMessages(input: {
  actorUserId: string;
  messages: GmailInboundMessage[];
  repository: GmailSyncRepository;
  apiKey: string | undefined;
  extractFacts: FactExtractor;
}): Promise<{
  fetched: number;
  imported: number;
  duplicates: number;
  ignored: number;
}> {
  let imported = 0;
  let duplicates = 0;
  let ignored = 0;

  for (const message of input.messages) {
    const existingMessage = await input.repository.findMessage(message.id);
    if (existingMessage) {
      await input.repository.recordProcessed({
        leadId: existingMessage.leadId,
        actorUserId: input.actorUserId,
        providerMessageId: message.id,
        threadId: message.threadId,
        sender: message.sender,
        senderEmail: message.senderEmail,
        subject: message.subject,
      });
      duplicates += 1;
      continue;
    }

    if (await input.repository.findIgnoredMessage(message.id)) {
      duplicates += 1;
      continue;
    }

    const classification = classifyGmailMessage(message);
    if (classification.type === "ignored") {
      try {
        await input.repository.recordIgnored({
          actorUserId: input.actorUserId,
          providerMessageId: message.id,
          threadId: message.threadId,
          reason: classification.reason,
        });
      } catch {
        throw new GmailSyncError(
          "persistence_failure",
          "An ignored Gmail message outcome could not be recorded. It will be retried on the next sync.",
        );
      }
      ignored += 1;
      continue;
    }

    const inquiry = [
      message.subject ? `Subject: ${message.subject}` : null,
      message.body,
    ]
      .filter(Boolean)
      .join("\n\n")
      .trim()
      .slice(0, 6000);
    if (!inquiry) {
      throw new GmailSyncError(
        "gmail_failure",
        "A Gmail message had no readable subject or body and could not be imported.",
      );
    }

    let qualification: QualificationResponse;
    try {
      qualification = await runLeadQualification(
        { inquiry },
        input.apiKey,
        input.extractFacts,
      );
    } catch (error) {
      if (error instanceof Error) {
        throw new GmailSyncError(
          "qualification_failure",
          `Could not qualify an incoming email: ${error.message}`,
          { cause: error },
        );
      }
      throw error;
    }

    const qualificationEvidence = makeEvidence(qualification);
    const status = mapStatus(qualification.finalStatus);
    const thread = await input.repository.findThread(message.threadId);
    const threadLead = thread
      ? await input.repository.findLead(thread.leadId)
      : null;
    const isNewLead = !threadLead;
    let leadId: string | null = null;
    let messageInserted = false;

    try {
      if (threadLead) {
        leadId = threadLead.id;
      } else {
        const lead = await input.repository.insertLead({
          fullName: message.sender ?? message.senderEmail,
          email: message.senderEmail,
          status,
          qualificationEvidence,
          lastActivityAt: message.sentAt,
        });
        leadId = lead.id;
      }
      if (!leadId) {
        throw new GmailSyncError(
          "persistence_failure",
          "The email could not be associated with a lead.",
        );
      }

      await input.repository.insertMessage({
        leadId,
        body: [
          message.subject ? `Subject: ${message.subject}` : null,
          message.body || "(No message body)",
        ]
          .filter(Boolean)
          .join("\n\n"),
        providerMessageId: message.id,
        sentAt: message.sentAt,
      });
      messageInserted = true;

      if (threadLead) {
        await input.repository.updateLead(leadId, {
          fullName: threadLead.fullName ?? message.sender,
          email: threadLead.email ?? message.senderEmail,
          status,
          qualificationEvidence,
          lastActivityAt: message.sentAt,
        });
      }

      if (status === "qualified") {
        await input.repository.assignQualifiedLead?.({
          leadId,
          actorUserId: input.actorUserId,
          channel: "email",
        });
      }

      await input.repository.recordProcessed({
        leadId,
        actorUserId: input.actorUserId,
        providerMessageId: message.id,
        threadId: message.threadId,
        sender: message.sender,
        senderEmail: message.senderEmail,
        subject: message.subject,
      });
      imported += 1;
    } catch (error) {
      if (messageInserted) {
        try {
          await input.repository.deleteMessage(message.id);
        } catch {
          console.error("[gmail] Failed to roll back an incomplete message write");
        }
      }
      if (isNewLead && leadId) {
        try {
          await input.repository.deleteLead(leadId);
        } catch {
          console.error("[gmail] Failed to roll back an incomplete lead write");
        }
      }
      if (error instanceof GmailSyncError) throw error;
      throw new GmailSyncError(
        "persistence_failure",
        "An incoming email could not be fully saved. It will be retried on the next sync.",
      );
    }
  }

  return { fetched: input.messages.length, imported, duplicates, ignored };
}

export async function runAuthenticatedGmailSync(input: {
  authenticate: () => Promise<{ userId: string }>;
  fetchMessages: (
    actorUserId: string,
  ) => Promise<GmailInboundMessage[]>;
  repository: GmailSyncRepository;
  apiKey: string | undefined;
  extractFacts: FactExtractor;
}): Promise<{
  actorUserId: string;
  result: {
    fetched: number;
    imported: number;
    duplicates: number;
    ignored: number;
  };
}> {
  const { userId } = await input.authenticate();
  if (activeSyncs.has(userId)) {
    throw new GmailSyncError(
      "sync_in_progress",
      "An email sync is already in progress for this account. Wait for it to finish before trying again.",
    );
  }
  activeSyncs.add(userId);
  try {
    const messages = await input.fetchMessages(userId);
    const result = await syncGmailMessages({
      actorUserId: userId,
      messages,
      repository: input.repository,
      apiKey: input.apiKey,
      extractFacts: input.extractFacts,
    });
    return { actorUserId: userId, result };
  } finally {
    activeSyncs.delete(userId);
  }
}
