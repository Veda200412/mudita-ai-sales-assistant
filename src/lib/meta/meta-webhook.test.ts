import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  ingestMetaMessages,
  type MetaInboundRepository,
} from "@/lib/meta/ingest";
import {
  MetaWebhookError,
  parseMetaWebhookPayload,
  verifyMetaChallenge,
  verifyMetaSignature,
  verifyMetaSignatureWithReason,
  type MetaInboundMessage,
} from "@/lib/meta/webhook";

const instagramPayload = {
  object: "instagram",
  entry: [{
    messaging: [{
      sender: { id: "ig-user-1" },
      recipient: { id: "ig-business-1" },
      timestamp: 1_797_000_000_000,
      message: { mid: "ig-msg-1", text: "Need sales analytics" },
    }],
  }],
};

const whatsappPayload = {
  object: "whatsapp_business_account",
  entry: [{
    changes: [{
      value: {
        metadata: { phone_number_id: "phone-1" },
        contacts: [{ wa_id: "919999999999", profile: { name: "Sam" } }],
        messages: [{
          from: "919999999999",
          id: "wamid.1",
          timestamp: "1797000000",
          type: "text",
          text: { body: "Please share information" },
        }],
      },
    }],
  }],
};

function makeMessage(overrides: Partial<MetaInboundMessage> = {}): MetaInboundMessage {
  return {
    channel: "instagram",
    id: "ig-msg-1",
    threadId: "ig-account-1:ig-user-1",
    senderId: "ig-user-1",
    senderName: null,
    sentAt: "2026-10-21T00:00:00.000Z",
    body: "Hello, need help",
    hasText: true,
    ...overrides,
  };
}

function makeRepository() {
  const messages = new Map<string, string>();
  const leads = new Map<string, {
    status: string;
    fullName: string | null;
    email: string | null;
  }>();
  const processed: Array<{ leadId: string; channel: string; threadId: string }> = [];
  let nextLead = 1;
  let assignmentCalls = 0;
  const repository: MetaInboundRepository = {
    async findMessage(channel, id) {
      const leadId = messages.get(`${channel}:${id}`);
      return leadId ? { leadId } : null;
    },
    async findThread(channel, threadId) {
      const row = processed.find(
        (entry) => entry.channel === channel && entry.threadId === threadId,
      );
      return row ? { leadId: row.leadId } : null;
    },
    async getLead(leadId) {
      const lead = leads.get(leadId);
      return lead
        ? { id: leadId, ...lead }
        : null;
    },
    async insertLead(input) {
      const id = `lead-${nextLead++}`;
      leads.set(id, {
        status: input.status,
        fullName: input.fullName,
        email: null,
      });
      return { id };
    },
    async updateLead(input) {
      const lead = leads.get(input.leadId);
      if (lead) {
        lead.fullName = input.fullName;
        lead.status = input.status;
      }
    },
    async insertMessage(input) {
      const key = `${input.channel}:${input.id}`;
      if (messages.has(key)) throw new Error("duplicate provider message");
      messages.set(key, input.leadId);
    },
    async deleteMessage(channel, id) {
      messages.delete(`${channel}:${id}`);
    },
    async deleteLead(id) {
      leads.delete(id);
      for (const [key, leadId] of messages) {
        if (leadId === id) messages.delete(key);
      }
    },
    async recordProcessed(input) {
      processed.push({
        leadId: input.leadId,
        channel: input.channel,
        threadId: input.threadId,
      });
    },
    async assignQualifiedLead() {
      assignmentCalls += 1;
    },
  };
  return {
    repository,
    messages,
    leads,
    processed,
    assignmentCalls: () => assignmentCalls,
  };
}

test("Meta webhook GET verification returns challenge only for matching verify token", () => {
  assert.equal(
    verifyMetaChallenge({
      mode: "subscribe",
      token: "configured",
      challenge: "challenge-value",
      configuredToken: "configured",
    }),
    "challenge-value",
  );
  assert.throws(
    () => verifyMetaChallenge({
      mode: "subscribe",
      token: "wrong",
      challenge: "challenge-value",
      configuredToken: "configured",
    }),
    (error: unknown) => error instanceof MetaWebhookError && error.code === "verification",
  );
});

test("Meta POST signatures validate exact raw payload and reject bad signatures", () => {
  const raw = JSON.stringify(instagramPayload);
  const secret = "test-app-secret";
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(verifyMetaSignature(raw, `sha256=${signature}`, secret), true);
  assert.equal(verifyMetaSignature(Buffer.from(raw), `sha256=${signature}`, secret), true);
  assert.equal(verifyMetaSignature(raw + " ", `sha256=${signature}`, secret), false);
  assert.equal(verifyMetaSignature(raw, "sha256=bad", secret), false);
  assert.deepEqual(verifyMetaSignatureWithReason(raw, null, secret), {
    valid: false,
    reason: "missing_header",
  });
  assert.deepEqual(verifyMetaSignatureWithReason(raw, "sha256=bad", secret), {
    valid: false,
    reason: "malformed_header",
  });
  assert.deepEqual(
    verifyMetaSignatureWithReason(raw, `sha256=${signature}`, "different-app-secret"),
    { valid: false, reason: "signature_mismatch" },
  );
  assert.throws(
    () => verifyMetaSignature(raw, null, undefined),
    (error: unknown) => error instanceof MetaWebhookError && error.code === "configuration",
  );
});

test("valid signed Meta payloads persist; invalid signatures never reach ingestion", async () => {
  const raw = JSON.stringify(instagramPayload);
  const secret = "instagram-app-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const store = makeRepository();
  const extractFacts = async () => ({
    requestedService: null,
    budgetInr: null,
    businessUseCase: null,
    genuineBusinessUseCase: null,
    evidence: {
      service: null,
      budgetInr: null,
      businessUseCase: null,
      genuineBusinessUseCase: null,
    },
  });

  const valid = verifyMetaSignatureWithReason(
    Buffer.from(raw),
    signature,
    secret,
  );
  assert.equal(valid.valid, true);
  if (valid.valid) {
    const messages = parseMetaWebhookPayload(JSON.parse(raw) as unknown, "instagram");
    const result = await ingestMetaMessages({
      messages,
      repository: store.repository,
      apiKey: "test-key",
      extractFacts,
    });
    assert.deepEqual(result, { received: 1, imported: 1, duplicates: 0 });
  }
  assert.equal(store.messages.size, 1);
  assert.equal(store.leads.size, 1);

  const invalid = verifyMetaSignatureWithReason(
    Buffer.from(raw),
    signature,
    "different-app-secret",
  );
  assert.equal(invalid.valid, false);
  assert.equal(store.messages.size, 1);
  assert.equal(store.leads.size, 1);
});

test("Instagram messages parse sender and account-scoped conversation identifiers", () => {
  const parsed = parseMetaWebhookPayload(instagramPayload, "instagram");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.id, "ig-msg-1");
  assert.equal(parsed[0]?.threadId, "ig-business-1:ig-user-1");
  assert.equal(parsed[0]?.senderId, "ig-user-1");
  assert.equal(parsed[0]?.body, "Need sales analytics");
});

test("WhatsApp text parses contact name and phone-number-scoped thread", () => {
  const parsed = parseMetaWebhookPayload(whatsappPayload, "whatsapp");
  assert.equal(parsed[0]?.channel, "whatsapp");
  assert.equal(parsed[0]?.id, "wamid.1");
  assert.equal(parsed[0]?.threadId, "phone-1:919999999999");
  assert.equal(parsed[0]?.senderName, "Sam");
});

test("malformed and cross-channel Meta webhook payloads are rejected", () => {
  assert.throws(
    () => parseMetaWebhookPayload({ object: "instagram" }, "instagram"),
    /entry is missing/,
  );
  assert.throws(
    () => parseMetaWebhookPayload(whatsappPayload, "instagram"),
    /does not match/,
  );
});

test("Meta event duplicates do not create duplicate leads or messages", async () => {
  const store = makeRepository();
  const input = {
    messages: [makeMessage()],
    repository: store.repository,
    apiKey: "test-key",
    extractFacts: async () => ({
      requestedService: null,
      budgetInr: null,
      businessUseCase: null,
      genuineBusinessUseCase: null,
      evidence: {
        service: null,
        budgetInr: null,
        businessUseCase: null,
        genuineBusinessUseCase: null,
      },
    }),
  };
  assert.deepEqual(await ingestMetaMessages(input), {
    received: 1,
    imported: 1,
    duplicates: 0,
  });
  assert.deepEqual(await ingestMetaMessages(input), {
    received: 1,
    imported: 0,
    duplicates: 1,
  });
  assert.equal(store.leads.size, 1);
  assert.equal(store.messages.size, 1);
});

test("multiple Meta messages from one conversation retain messages on one lead", async () => {
  const store = makeRepository();
  const result = await ingestMetaMessages({
    messages: [
      makeMessage({ id: "message-1" }),
      makeMessage({ id: "message-2", body: "More details" }),
    ],
    repository: store.repository,
    apiKey: "test-key",
    extractFacts: async () => ({
      requestedService: null,
      budgetInr: null,
      businessUseCase: null,
      genuineBusinessUseCase: null,
      evidence: {
        service: null,
        budgetInr: null,
        businessUseCase: null,
        genuineBusinessUseCase: null,
      },
    }),
  });
  assert.deepEqual(result, { received: 2, imported: 2, duplicates: 0 });
  assert.equal(store.leads.size, 1);
  assert.equal(store.messages.size, 2);
  assert.equal(store.processed[0]?.leadId, store.processed[1]?.leadId);
});

test("persistence failure rolls back unprocessed Meta lead and message", async () => {
  const store = makeRepository();
  const repository = {
    ...store.repository,
    async recordProcessed(): Promise<void> {
      throw new Error("database unavailable");
    },
  };
  await assert.rejects(
    ingestMetaMessages({
      messages: [makeMessage()],
      repository,
      apiKey: "test-key",
      extractFacts: async () => ({
        requestedService: null,
        budgetInr: null,
        businessUseCase: null,
        genuineBusinessUseCase: null,
        evidence: {
          service: null,
          budgetInr: null,
          businessUseCase: null,
          genuineBusinessUseCase: null,
        },
      }),
    }),
    /could not be fully persisted/,
  );
  assert.equal(store.leads.size, 0);
  assert.equal(store.messages.size, 0);
  assert.equal(store.processed.length, 0);
});

test("qualified Meta lead delegates assignment to the takeover-aware policy repository", async () => {
  const store = makeRepository();
  const body = "We need sales and revenue analytics for forecasting retail sales for our business reporting project. Our budget is INR 75,000.";
  const result = await ingestMetaMessages({
    messages: [makeMessage({ body })],
    repository: store.repository,
    apiKey: "test-key",
    extractFacts: async () => ({
      requestedService: "sales_revenue_analytics",
      budgetInr: 75_000,
      businessUseCase: "forecasting retail sales for our business reporting project",
      genuineBusinessUseCase: true,
      evidence: {
        service: "sales and revenue analytics",
        budgetInr: "INR 75,000",
        businessUseCase: "forecasting retail sales for our business reporting project",
        genuineBusinessUseCase: "for our business reporting project",
      },
    }),
  });
  assert.equal(result.imported, 1);
  assert.equal(store.assignmentCalls(), 1);
});
