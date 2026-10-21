import assert from "node:assert/strict";
import test from "node:test";
import {
  LeadPersistenceError,
  qualifyAndPersistLead,
  type LeadPersistenceRepository,
  type PersistedLead,
} from "@/lib/lead-persistence";
import type { ExtractedInquiryFacts } from "@/lib/qualification";

const idempotencyKey = "a7ea43ee-ec46-49da-9c0e-6105971a4a1e";
const request = {
  inquiry:
    "We need sales and revenue analytics to forecast retail sales for our business. Budget is INR 75,000.",
  channel: "email",
};
const facts: ExtractedInquiryFacts = {
  requestedService: "sales_revenue_analytics",
  budgetInr: 75_000,
  businessUseCase: "forecast retail sales for our business",
  genuineBusinessUseCase: true,
  evidence: {
    service: "sales and revenue analytics",
    budgetInr: "Budget is INR 75,000",
    businessUseCase: "forecast retail sales for our business",
    genuineBusinessUseCase: "for our business",
  },
};

function makeRepository() {
  const leads = new Map<string, PersistedLead>();
  const messages = new Map<string, { leadId: string; body: string }>();
  const logs = new Set<string>();
  let nextId = 1;

  const repository: LeadPersistenceRepository = {
    async findMessage(channel, key) {
      const message = messages.get(`${channel}:${key}`);
      return message ? { leadId: message.leadId } : null;
    },
    async findLead(leadId) {
      return leads.get(leadId) ?? null;
    },
    async insertLead(input) {
      const lead = { id: `lead-${nextId++}`, status: input.status };
      leads.set(lead.id, lead);
      return lead;
    },
    async insertInboundMessage(input) {
      const key = `${input.channel}:${input.idempotencyKey}`;
      if (messages.has(key)) {
        throw new LeadPersistenceError(
          "database_failure",
          "Duplicate message.",
          "23505",
        );
      }
      messages.set(key, { leadId: input.leadId, body: input.body });
    },
    async deleteLead(leadId) {
      leads.delete(leadId);
    },
    async ensureActionLog(input) {
      logs.add(`${input.leadId}:${input.idempotencyKey}`);
      return true;
    },
  };

  return { repository, leads, messages, logs };
}

test("qualifies and persists a lead, inbound message, and action log", async () => {
  const store = makeRepository();
  const result = await qualifyAndPersistLead(
    request,
    idempotencyKey,
    "auth-user-1",
    "mock-gemini-key",
    async () => facts,
    store.repository,
  );

  assert.equal(result.lead.status, "qualified");
  assert.equal(result.duplicate, false);
  assert.equal(result.qualification?.finalStatus, "qualified");
  assert.equal(store.leads.size, 1);
  assert.equal(store.messages.size, 1);
  assert.equal(store.logs.size, 1);
  assert.equal(
    store.messages.get(`email:${idempotencyKey}`)?.body,
    request.inquiry,
  );
});

test("removes the incomplete lead and reports a message database failure", async () => {
  const store = makeRepository();
  const failingRepository: LeadPersistenceRepository = {
    ...store.repository,
    async insertInboundMessage() {
      throw new LeadPersistenceError(
        "database_failure",
        "The inquiry could not be saved. Please try again.",
        "42501",
      );
    },
  };

  await assert.rejects(
    qualifyAndPersistLead(
      request,
      idempotencyKey,
      "auth-user-1",
      "mock-gemini-key",
      async () => facts,
      failingRepository,
    ),
    (error: unknown) =>
      error instanceof LeadPersistenceError &&
      error.code === "database_failure",
  );
  assert.equal(store.leads.size, 0);
});

test("rejects invalid submissions before calling Gemini or writing", async () => {
  const store = makeRepository();
  let extractorCalled = false;

  await assert.rejects(
    qualifyAndPersistLead(
      { inquiry: " ", channel: "sms" },
      idempotencyKey,
      "auth-user-1",
      "mock-gemini-key",
      async () => {
        extractorCalled = true;
        return facts;
      },
      store.repository,
    ),
    (error: unknown) =>
      error instanceof LeadPersistenceError &&
      error.code === "invalid_request",
  );
  assert.equal(extractorCalled, false);
  assert.equal(store.leads.size, 0);
});

test("returns the original lead for a retried idempotency key", async () => {
  const store = makeRepository();
  let extractorCalls = 0;
  const extractFacts = async () => {
    extractorCalls += 1;
    return facts;
  };

  const first = await qualifyAndPersistLead(
    request,
    idempotencyKey,
    "auth-user-1",
    "mock-gemini-key",
    extractFacts,
    store.repository,
  );
  const retry = await qualifyAndPersistLead(
    request,
    idempotencyKey,
    "auth-user-1",
    "mock-gemini-key",
    extractFacts,
    store.repository,
  );

  assert.equal(first.lead.id, retry.lead.id);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.qualification, null);
  assert.equal(extractorCalls, 1);
  assert.equal(store.leads.size, 1);
  assert.equal(store.messages.size, 1);
});
