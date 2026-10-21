import { classifyGmailMessage, type GmailIgnoredReason } from "@/lib/gmail/classify-message";
import type { ParsedGmailMessage } from "@/lib/gmail/message-parser";

export type GmailCleanupCategory =
  | "likely_non_sales"
  | "potential_genuine_inquiry"
  | "needs_manual_review";

export interface GmailCleanupLead {
  leadId: string;
  fullName: string | null;
  email: string | null;
  messageIds: string[];
  messages: ParsedGmailMessage[];
  hasIncompleteHistory: boolean;
}

export interface GmailCleanupPreviewItem {
  leadId: string;
  fullName: string | null;
  email: string | null;
  category: GmailCleanupCategory;
  reasons: GmailIgnoredReason[];
  messageIds: string[];
  messageCount: number;
}

export function classifyCleanupLead(
  lead: GmailCleanupLead,
): GmailCleanupPreviewItem {
  const base = {
    leadId: lead.leadId,
    fullName: lead.fullName,
    email: lead.email,
    messageIds: lead.messageIds,
    messageCount: lead.messageIds.length,
  };
  if (
    lead.hasIncompleteHistory ||
    lead.messages.length === 0 ||
    lead.messages.length !== lead.messageIds.length
  ) {
    return {
      ...base,
      category: "needs_manual_review",
      reasons: [],
    };
  }

  const classifications = lead.messages.map(classifyGmailMessage);
  if (classifications.some((result) => result.type === "sales_inquiry")) {
    return {
      ...base,
      category: "potential_genuine_inquiry",
      reasons: [],
    };
  }

  const reasons = Array.from(
    new Set(
      classifications.flatMap((result) =>
        result.type === "ignored" && result.reason !== "missing_sender_email"
          ? [result.reason]
          : [],
      ),
    ),
  );
  if (
    reasons.length === 0 ||
    classifications.some(
      (result) =>
        result.type !== "ignored" ||
        result.reason === "missing_sender_email",
    )
  ) {
    return {
      ...base,
      category: "needs_manual_review",
      reasons: [],
    };
  }

  return {
    ...base,
    category: "likely_non_sales",
    reasons,
  };
}

export async function runAuthenticatedCleanupPreview<T>(input: {
  authenticate: () => Promise<{ userId: string }>;
  loadLeads: () => Promise<T[]>;
  classify: (lead: T) => GmailCleanupPreviewItem;
}): Promise<{ actorUserId: string; items: GmailCleanupPreviewItem[] }> {
  const actor = await input.authenticate();
  const leads = await input.loadLeads();
  return {
    actorUserId: actor.userId,
    items: leads.map(input.classify),
  };
}

export interface GmailCleanupConfirmationRepository {
  getPreview(
    previewId: string,
    actorUserId: string,
  ): Promise<{ metadata: Record<string, unknown> } | null>;
  claimPreview(
    previewId: string,
    actorUserId: string,
    selectedLeadIds: string[],
  ): Promise<boolean>;
  hasIgnoredMarker(leadId: string): Promise<boolean>;
  recordIgnored(
    actorUserId: string,
    previewId: string,
    item: GmailCleanupPreviewItem,
  ): Promise<void>;
  recordSummary(
    actorUserId: string,
    previewId: string,
    leadIds: string[],
  ): Promise<void>;
  updatePreviewStatus(
    previewId: string,
    actorUserId: string,
    status: "failed" | "confirmed",
    selectedLeadIds: string[],
  ): Promise<void>;
}

function storedItems(value: unknown): GmailCleanupPreviewItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item)
    ) {
      return [];
    }
    const record = item as Record<string, unknown>;
    if (typeof record.leadId !== "string") return [];
    const category: GmailCleanupCategory =
      record.category === "likely_non_sales" ||
      record.category === "potential_genuine_inquiry" ||
      record.category === "needs_manual_review"
        ? record.category
        : "needs_manual_review";
    const messageIds = Array.isArray(record.messageIds)
      ? record.messageIds.filter(
          (messageId): messageId is string => typeof messageId === "string",
        )
      : [];
    return [{
      leadId: record.leadId,
      fullName: null,
      email: null,
      category,
      reasons: Array.isArray(record.reasons)
        ? record.reasons.filter(
            (reason): reason is GmailIgnoredReason =>
              typeof reason === "string",
          )
        : [],
      messageIds,
      messageCount: messageIds.length,
    }];
  });
}

export async function runAuthenticatedCleanupConfirmation(input: {
  authenticate: () => Promise<{ userId: string }>;
  previewId: string;
  selectedLeadIds: string[];
  repository: GmailCleanupConfirmationRepository;
  loadLeads: (actorUserId: string) => Promise<GmailCleanupLead[]>;
}): Promise<{ actorUserId: string; alreadyConfirmed: boolean; ignored: number }> {
  const actor = await input.authenticate();
  const preview = await input.repository.getPreview(
    input.previewId,
    actor.userId,
  );
  if (!preview) throw new Error("Cleanup preview was not found.");
  const status =
    typeof preview.metadata.status === "string"
      ? preview.metadata.status
      : "invalid";
  const candidates = storedItems(preview.metadata.items).filter(
    (item) => item.category === "likely_non_sales",
  );
  const candidateIds = new Set(candidates.map((item) => item.leadId));
  if (
    input.selectedLeadIds.length === 0 ||
    input.selectedLeadIds.length > 500 ||
    new Set(input.selectedLeadIds).size !== input.selectedLeadIds.length ||
    input.selectedLeadIds.some((id) => !candidateIds.has(id))
  ) {
    throw new Error("Only previewed likely non-sales leads can be selected.");
  }
  const previousSelection = Array.isArray(preview.metadata.selectedLeadIds)
    ? preview.metadata.selectedLeadIds.filter(
        (id): id is string => typeof id === "string",
      )
    : [];
  if (status === "confirmed") {
    if (
      previousSelection.length !== input.selectedLeadIds.length ||
      previousSelection.some((id) => !input.selectedLeadIds.includes(id))
    ) {
      throw new Error("Confirmed cleanup selection cannot be changed.");
    }
    return {
      actorUserId: actor.userId,
      alreadyConfirmed: true,
      ignored: input.selectedLeadIds.length,
    };
  }
  if (status !== "previewed" && status !== "failed") {
    throw new Error("Cleanup preview is not ready for confirmation.");
  }
  if (
    status === "failed" &&
    (previousSelection.length !== input.selectedLeadIds.length ||
      previousSelection.some((id) => !input.selectedLeadIds.includes(id)))
  ) {
    throw new Error("Retry must use the original cleanup selection.");
  }
  const claimed = await input.repository.claimPreview(
    input.previewId,
    actor.userId,
    input.selectedLeadIds,
  );
  if (!claimed) {
    const latest = await input.repository.getPreview(
      input.previewId,
      actor.userId,
    );
    if (latest?.metadata.status === "confirmed") {
      return {
        actorUserId: actor.userId,
        alreadyConfirmed: true,
        ignored: input.selectedLeadIds.length,
      };
    }
    throw new Error("Cleanup confirmation is already in progress.");
  }

  try {
    const currentLeads = await input.loadLeads(actor.userId);
    const currentById = new Map(
      currentLeads.map((lead) => [lead.leadId, classifyCleanupLead(lead)]),
    );
    const currentItems = input.selectedLeadIds.map((id) => currentById.get(id));
    if (
      currentItems.some(
        (item) => !item || item.category !== "likely_non_sales",
      )
    ) {
      await input.repository.updatePreviewStatus(
        input.previewId,
        actor.userId,
        "failed",
        input.selectedLeadIds,
      );
      throw new Error(
        "Selected leads changed since preview. Create a new preview and review again.",
      );
    }
    const applied: string[] = [];
    for (const item of currentItems) {
      if (!item) continue;
      if (!(await input.repository.hasIgnoredMarker(item.leadId))) {
        await input.repository.recordIgnored(
          actor.userId,
          input.previewId,
          item,
        );
      }
      applied.push(item.leadId);
    }
    await input.repository.recordSummary(
      actor.userId,
      input.previewId,
      applied,
    );
    await input.repository.updatePreviewStatus(
      input.previewId,
      actor.userId,
      "confirmed",
      input.selectedLeadIds,
    );
    return {
      actorUserId: actor.userId,
      alreadyConfirmed: false,
      ignored: applied.length,
    };
  } catch (error) {
    const latest = await input.repository.getPreview(
      input.previewId,
      actor.userId,
    );
    if (latest?.metadata.status !== "failed") {
      await input.repository.updatePreviewStatus(
        input.previewId,
        actor.userId,
        "failed",
        input.selectedLeadIds,
      );
    }
    throw error;
  }
}
