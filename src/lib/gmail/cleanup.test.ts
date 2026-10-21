import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyCleanupLead,
  runAuthenticatedCleanupConfirmation,
  runAuthenticatedCleanupPreview,
  type GmailCleanupConfirmationRepository,
  type GmailCleanupLead,
} from "@/lib/gmail/cleanup";
import type { ParsedGmailMessage } from "@/lib/gmail/message-parser";

const automatedMessage: ParsedGmailMessage = {
  id: "gmail-automated-message",
  threadId: "gmail-automated-thread",
  sender: "Glassdoor Jobs",
  senderEmail: "jobs@glassdoor.com",
  fromConnectedMailbox: false,
  subject: "New jobs matching your alert",
  sentAt: "2026-01-02T03:04:05.000Z",
  body: "Here are new openings.",
  autoSubmitted: null,
  precedence: null,
  listId: null,
  autoResponseSuppress: null,
};

const inquiryMessage: ParsedGmailMessage = {
  id: "gmail-inquiry-message",
  threadId: "gmail-inquiry-thread",
  sender: "Alex Customer",
  senderEmail: "alex@example.com",
  fromConnectedMailbox: false,
  subject: "Sales analytics question",
  sentAt: "2026-01-02T03:04:05.000Z",
  body: "We need analytics to forecast sales.",
  autoSubmitted: null,
  precedence: null,
  listId: null,
  autoResponseSuppress: null,
};

function cleanupLead(
  leadId: string,
  message: ParsedGmailMessage,
  hasIncompleteHistory = false,
): GmailCleanupLead {
  return {
    leadId,
    fullName: message.sender,
    email: message.senderEmail,
    messageIds: [message.id],
    messages: [message],
    hasIncompleteHistory,
  };
}

test("dry-run classifies historical Gmail leads without changing their data", async () => {
  const existing = cleanupLead("lead-automated", automatedMessage);
  const result = await runAuthenticatedCleanupPreview({
    authenticate: async () => ({ userId: "rep-1" }),
    loadLeads: async () => [existing],
    classify: classifyCleanupLead,
  });

  assert.equal(result.actorUserId, "rep-1");
  assert.equal(result.items[0]?.category, "likely_non_sales");
  assert.deepEqual(result.items[0]?.reasons, ["job_alert"]);
  assert.equal(existing.messages[0]?.id, "gmail-automated-message");
  assert.deepEqual(existing.messageIds, ["gmail-automated-message"]);
});

test("preview marks potential inquiries separately and sends ambiguous history to review", () => {
  assert.equal(
    classifyCleanupLead(cleanupLead("lead-inquiry", inquiryMessage)).category,
    "potential_genuine_inquiry",
  );
  assert.equal(
    classifyCleanupLead(
      cleanupLead("lead-incomplete", inquiryMessage, true),
    ).category,
    "needs_manual_review",
  );
  const missingSender = {
    ...inquiryMessage,
    senderEmail: null,
  };
  assert.equal(
    classifyCleanupLead(cleanupLead("lead-missing-sender", missingSender)).category,
    "needs_manual_review",
  );
  const unnamed = cleanupLead("lead-unnamed", automatedMessage);
  unnamed.fullName = null;
  assert.equal(classifyCleanupLead(unnamed).category, "likely_non_sales");
});

test("preview authorization failure does not load cleanup records", async () => {
  let loaded = false;
  await assert.rejects(
    runAuthenticatedCleanupPreview({
      authenticate: async () => {
        throw new Error("unauthorized");
      },
      loadLeads: async () => {
        loaded = true;
        return [];
      },
      classify: classifyCleanupLead,
    }),
    /unauthorized/,
  );
  assert.equal(loaded, false);
});

test("confirmation authorization failure does not read or change the preview", async () => {
  let readPreview = false;
  const repository: GmailCleanupConfirmationRepository = {
    async getPreview() {
      readPreview = true;
      return null;
    },
    async claimPreview() {
      return false;
    },
    async hasIgnoredMarker() {
      return false;
    },
    async recordIgnored() {},
    async recordSummary() {},
    async updatePreviewStatus() {},
  };

  await assert.rejects(
    runAuthenticatedCleanupConfirmation({
      authenticate: async () => {
        throw new Error("unauthorized");
      },
      previewId: "preview-1",
      selectedLeadIds: ["lead-1"],
      repository,
      loadLeads: async () => [cleanupLead("lead-1", automatedMessage)],
    }),
    /unauthorized/,
  );
  assert.equal(readPreview, false);
});

test("confirmation is idempotent and preserves message and thread history", async () => {
  const originalMessage = cleanupLead("lead-1", automatedMessage);
  const persistedMessages = [...originalMessage.messages];
  const previewMetadata: Record<string, unknown> = {
    status: "previewed",
    items: [{
      leadId: "lead-1",
      category: "likely_non_sales",
      reasons: ["job_alert"],
      messageIds: [automatedMessage.id],
    }, {
      leadId: "lead-2",
      category: "likely_non_sales",
      reasons: ["automated_sender"],
      messageIds: ["another-automated-message"],
    }],
  };
  const ignoredLeadIds = new Set<string>();
  let markerWrites = 0;
  let summaryWrites = 0;
  const repository: GmailCleanupConfirmationRepository = {
    async getPreview() {
      return { metadata: previewMetadata };
    },
    async claimPreview(_id, _userId, selected) {
      if (previewMetadata.status !== "previewed") return false;
      previewMetadata.status = "confirming";
      previewMetadata.selectedLeadIds = selected;
      return true;
    },
    async hasIgnoredMarker(leadId) {
      return ignoredLeadIds.has(leadId);
    },
    async recordIgnored(_userId, _previewId, item) {
      markerWrites += 1;
      ignoredLeadIds.add(item.leadId);
    },
    async recordSummary() {
      summaryWrites += 1;
    },
    async updatePreviewStatus(_id, _userId, status, selected) {
      previewMetadata.status = status;
      previewMetadata.selectedLeadIds = selected;
    },
  };
  const input = {
    authenticate: async () => ({ userId: "rep-1" }),
    previewId: "preview-1",
    selectedLeadIds: ["lead-1"],
    repository,
    loadLeads: async () => [originalMessage],
  };
  const first = await runAuthenticatedCleanupConfirmation(input);
  const repeated = await runAuthenticatedCleanupConfirmation(input);

  assert.deepEqual(first, {
    actorUserId: "rep-1",
    alreadyConfirmed: false,
    ignored: 1,
  });
  assert.deepEqual(repeated, {
    actorUserId: "rep-1",
    alreadyConfirmed: true,
    ignored: 1,
  });
  await assert.rejects(
    runAuthenticatedCleanupConfirmation({
      ...input,
      selectedLeadIds: ["lead-2"],
    }),
    /selection cannot be changed/,
  );
  assert.equal(markerWrites, 1);
  assert.equal(summaryWrites, 1);
  assert.deepEqual(originalMessage.messages, persistedMessages);
  assert.equal(originalMessage.messages[0]?.threadId, "gmail-automated-thread");
  assert.equal(originalMessage.messages[0]?.id, "gmail-automated-message");
});

test("confirmation rejects a lead that became a potential inquiry after preview", async () => {
  const previewMetadata: Record<string, unknown> = {
    status: "previewed",
    items: [{
      leadId: "lead-1",
      category: "likely_non_sales",
      reasons: ["job_alert"],
      messageIds: [automatedMessage.id],
    }],
  };
  let status = "previewed";
  const repository: GmailCleanupConfirmationRepository = {
    async getPreview() {
      return { metadata: previewMetadata };
    },
    async claimPreview() {
      status = "confirming";
      previewMetadata.status = status;
      return true;
    },
    async hasIgnoredMarker() {
      return false;
    },
    async recordIgnored() {
      assert.fail("Changed genuine inquiry must not be marked ignored.");
    },
    async recordSummary() {},
    async updatePreviewStatus(_id, _userId, nextStatus) {
      status = nextStatus;
      previewMetadata.status = nextStatus;
    },
  };

  await assert.rejects(
    runAuthenticatedCleanupConfirmation({
      authenticate: async () => ({ userId: "rep-1" }),
      previewId: "preview-1",
      selectedLeadIds: ["lead-1"],
      repository,
      loadLeads: async () => [cleanupLead("lead-1", inquiryMessage)],
    }),
    /changed since preview/,
  );
  assert.equal(status, "failed");
});
