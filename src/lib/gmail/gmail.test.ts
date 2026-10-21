import assert from "node:assert/strict";
import test from "node:test";
import {
  parseGmailMessage,
  type ParsedGmailMessage,
} from "@/lib/gmail/message-parser";
import {
  runAuthenticatedGmailSync,
  type GmailSyncRepository,
} from "@/lib/gmail/sync";
import { QualificationError } from "@/lib/qualification";
import {
  getOAuthCallbackFailureMessage,
  sanitizeOAuthErrorMessage,
} from "@/lib/gmail/callback-diagnostics";
import { ApiError } from "@google/genai";
import {
  diagnoseGeminiFailure,
  getGeminiFailureAction,
} from "@/lib/gemini-diagnostics";
import { GEMINI_MODEL } from "@/lib/config";
import type { LeadStatus } from "@/lib/types/lead";

function encoded(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

const facts = {
  requestedService: "sales_revenue_analytics",
  budgetInr: 75_000,
  businessUseCase: "forecast retail sales",
  genuineBusinessUseCase: true,
  evidence: {
    service: "sales analytics",
    budgetInr: "Budget is INR 75,000",
    businessUseCase: "forecast retail sales",
    genuineBusinessUseCase: "forecast retail sales",
  },
};

const oneMessage: ParsedGmailMessage = {
  id: "gmail-message-1",
  threadId: "gmail-thread-1",
  sender: "Alex Customer",
  senderEmail: "alex@example.com",
  fromConnectedMailbox: false,
  subject: "Analytics inquiry",
  sentAt: "2026-01-02T03:04:05.000Z",
  body: "We need sales analytics to forecast retail sales. Budget is INR 75,000.",
  autoSubmitted: null,
  precedence: null,
  listId: null,
  autoResponseSuppress: null,
};

test("reports OAuth failure stage safely without logging secrets or callback URLs", () => {
  const sensitiveError =
    "exchange failed at https://example.test/callback?code=oauth-code-12345678901234567890 " +
    "access_token=access-token-value-12345678901234567890 " +
    "GMAIL_TOKEN_ENCRYPTION_KEY=key-value-12345678901234567890";
  const sanitized = sanitizeOAuthErrorMessage(sensitiveError);

  assert.equal(sanitized.includes("https://"), false);
  assert.equal(sanitized.includes("oauth-code-12345678901234567890"), false);
  assert.equal(sanitized.includes("access-token-value-12345678901234567890"), false);
  assert.equal(sanitized.includes("key-value-12345678901234567890"), false);
  assert.match(
    getOAuthCallbackFailureMessage("token_encryption", new Error(sensitiveError), false),
    /GMAIL_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes/,
  );
});

test("classifies Gemini API errors by HTTP status without exposing API error bodies", () => {
  const error = new ApiError({
    status: 429,
    message:
      '{"error":{"message":"sensitive email text and credential data","status":"RESOURCE_EXHAUSTED"}}',
  });

  assert.deepEqual(diagnoseGeminiFailure(error), {
    status: 429,
    category: "quota_or_rate_limit",
    errorName: "ApiError",
    causeName: null,
    causeCode: null,
    safeMessage: "Gemini API returned HTTP 429.",
  });
  assert.deepEqual(
    diagnoseGeminiFailure(new ApiError({ status: 404, message: "not found" })),
    {
      status: 404,
      category: "model_or_endpoint_not_found",
      errorName: "ApiError",
      causeName: null,
      causeCode: null,
      safeMessage: "Gemini API returned HTTP 404.",
    },
  );
  assert.deepEqual(
    diagnoseGeminiFailure(new Error("network unavailable")),
    {
      status: null,
      category: "network_dns_tls_error",
      errorName: "Error",
      causeName: null,
      causeCode: null,
      safeMessage: "Gemini network, DNS, or TLS connection failed.",
    },
  );
});

test("classifies Gemini timeout, DNS/TLS, nested HTTP, and SDK errors safely", () => {
  const timeout = Object.assign(new Error("request timed out"), {
    name: "TimeoutError",
    cause: Object.assign(new Error("timer stopped"), { code: "ETIMEDOUT" }),
  });
  const dnsError = Object.assign(new Error("request failed"), {
    cause: Object.assign(new Error("getaddrinfo failed"), {
      code: "ENOTFOUND",
    }),
  });
  const tlsError = Object.assign(new Error("request failed"), {
    cause: Object.assign(new Error("certificate rejected"), {
      code: "CERT_HAS_EXPIRED",
    }),
  });
  const sdkError = Object.assign(new Error("sdk internal failure"), {
    name: "APIConnectionError",
  });
  const nestedHttpError = Object.assign(new Error("request failed"), {
    cause: new ApiError({ status: 403, message: "private request data" }),
  });

  assert.equal(diagnoseGeminiFailure(timeout).category, "timeout_or_abort");
  assert.equal(
    diagnoseGeminiFailure(
      Object.assign(new Error("SDK request timed out"), {
        name: "APIConnectionTimeoutError",
        cause: Object.assign(new Error("Request timed out"), {
          name: "RequestTimeoutError",
        }),
      }),
    ).causeName,
    "RequestTimeoutError",
  );
  assert.equal(diagnoseGeminiFailure(dnsError).causeCode, "ENOTFOUND");
  assert.equal(diagnoseGeminiFailure(tlsError).category, "network_dns_tls_error");
  assert.equal(diagnoseGeminiFailure(sdkError).category, "sdk_error");
  assert.equal(diagnoseGeminiFailure(nestedHttpError).status, 403);
  assert.equal(
    getGeminiFailureAction("authentication_or_permission"),
    "Check that GEMINI_API_KEY is valid and has Gemini API access.",
  );
  assert.equal(
    diagnoseGeminiFailure(nestedHttpError).safeMessage.includes("private"),
    false,
  );
});

test("uses Google's documented Gemini 3.5 Flash-Lite model ID", () => {
  assert.equal(GEMINI_MODEL, "gemini-3.5-flash-lite");
});

function makeRepository() {
  const leads = new Map<
    string,
    {
      id: string;
      status: LeadStatus;
      fullName: string | null;
      email: string | null;
    }
  >();
  const messages = new Map<
    string,
    { leadId: string; body: string; sentAt: string }
  >();
  const processed = new Map<string, { leadId: string; threadId: string }>();
  const ignored = new Map<string, string>();
  let nextId = 0;

  const repository: GmailSyncRepository = {
    async findMessage(providerMessageId) {
      const message = messages.get(providerMessageId);
      return message ? { leadId: message.leadId } : null;
    },
    async findIgnoredMessage(providerMessageId) {
      return ignored.has(providerMessageId);
    },
    async findThread(threadId) {
      const record = Array.from(processed.values()).find(
        (entry) => entry.threadId === threadId,
      );
      return record ? { leadId: record.leadId } : null;
    },
    async findLead(leadId) {
      return leads.get(leadId) ?? null;
    },
    async insertLead(input) {
      const lead = {
        id: `lead-${++nextId}`,
        status: input.status,
        fullName: input.fullName,
        email: input.email,
      };
      leads.set(lead.id, lead);
      return { id: lead.id, status: lead.status };
    },
    async updateLead(leadId, input) {
      const lead = leads.get(leadId);
      assert.ok(lead);
      leads.set(leadId, {
        ...lead,
        status: input.status,
        fullName: input.fullName,
        email: input.email,
      });
    },
    async insertMessage(input) {
      if (messages.has(input.providerMessageId)) {
        throw new Error("duplicate provider message");
      }
      messages.set(input.providerMessageId, {
        leadId: input.leadId,
        body: input.body,
        sentAt: input.sentAt,
      });
    },
    async deleteMessage(providerMessageId) {
      messages.delete(providerMessageId);
    },
    async deleteLead(leadId) {
      leads.delete(leadId);
      for (const [id, message] of messages) {
        if (message.leadId === leadId) messages.delete(id);
      }
    },
    async recordProcessed(input) {
      processed.set(input.providerMessageId, {
        leadId: input.leadId,
        threadId: input.threadId,
      });
    },
    async recordIgnored(input) {
      ignored.set(input.providerMessageId, input.reason);
    },
  };

  return { repository, leads, messages, processed, ignored };
}

function runSync(
  repository: GmailSyncRepository,
  messages: ParsedGmailMessage[],
) {
  return runAuthenticatedGmailSync({
    authenticate: async () => ({ userId: "active-representative" }),
    fetchMessages: async () => messages,
    repository,
    apiKey: "mock-gemini-key",
    extractFacts: async () => facts,
  });
}

test("parses Gmail headers and plain-text MIME body", () => {
  const parsed = parseGmailMessage({
    id: "msg-1",
    threadId: "thread-1",
    internalDate: "1767323045000",
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "From", value: "Alex Customer <alex@example.com>" },
        { name: "Subject", value: "A real inquiry" },
      ],
      parts: [
        { mimeType: "text/plain", body: { data: encoded("Hello from Gmail.") } },
        {
          mimeType: "text/html",
          body: { data: encoded("<p>Alternate HTML body</p>") },
        },
      ],
    },
  });

  assert.ok(parsed);
  assert.equal(parsed.id, "msg-1");
  assert.equal(parsed.threadId, "thread-1");
  assert.equal(parsed.senderEmail, "alex@example.com");
  assert.equal(parsed.sender, "Alex Customer");
  assert.equal(parsed.fromConnectedMailbox, false);
  assert.equal(parsed.subject, "A real inquiry");
  assert.equal(parsed.body, "Hello from Gmail.");
  assert.equal(parsed.sentAt, new Date(1767323045000).toISOString());
});

test("converts HTML body to text and handles missing optional fields", () => {
  const parsed = parseGmailMessage({
    id: "msg-html",
    threadId: "thread-html",
    snippet: "fallback snippet",
    payload: {
      mimeType: "text/html",
      parts: [
        {
          mimeType: "text/html",
          body: {
            data: encoded(
              "<p>We need <strong>sales analytics</strong>.</p><script>secret()</script>",
            ),
          },
        },
      ],
    },
  });

  assert.ok(parsed);
  assert.equal(parsed.sender, null);
  assert.equal(parsed.senderEmail, null);
  assert.equal(parsed.fromConnectedMailbox, false);
  assert.equal(parsed.autoSubmitted, null);
  assert.equal(parsed.subject, null);
  assert.equal(parsed.body, "We need  sales analytics .");
  assert.ok(Number.isFinite(Date.parse(parsed.sentAt)));
  assert.equal(parseGmailMessage({ id: "missing-thread" }), null);
});

test("records Glassdoor job alerts as ignored, not leads", async () => {
  const store = makeRepository();
  const parsed = parseGmailMessage({
    id: "glassdoor-message",
    threadId: "glassdoor-thread",
    payload: {
      headers: [
        { name: "From", value: "Glassdoor Jobs <jobs@glassdoor.com>" },
        { name: "Subject", value: "New jobs matching your alert" },
      ],
      mimeType: "text/plain",
      body: { data: encoded("A list of job openings.") },
    },
  });
  assert.ok(parsed);

  const result = await runSync(store.repository, [parsed]);
  assert.deepEqual(result.result, {
    fetched: 1,
    imported: 0,
    duplicates: 0,
    ignored: 1,
  });
  assert.equal(store.leads.size, 0);
  assert.equal(store.messages.size, 0);
  assert.equal(store.ignored.get("glassdoor-message"), "job_alert");
});

test("records Google notifications and automated messages explicitly", async () => {
  const store = makeRepository();
  const parsed = parseGmailMessage({
    id: "google-alert-message",
    threadId: "google-alert-thread",
    payload: {
      headers: [
        { name: "From", value: "Google <no-reply@accounts.google.com>" },
        { name: "Subject", value: "Google Account security alert" },
      ],
      mimeType: "text/plain",
      body: { data: encoded("A security notification.") },
    },
  });
  assert.ok(parsed);

  const result = await runSync(store.repository, [parsed]);
  assert.equal(result.result.ignored, 1);
  assert.equal(store.leads.size, 0);
  assert.equal(store.ignored.get("google-alert-message"), "automated_sender");
});

test("ignores messages sent by the connected mailbox", async () => {
  const store = makeRepository();
  const parsed = parseGmailMessage(
    {
      id: "self-message",
      threadId: "self-thread",
      payload: {
        headers: [
          { name: "From", value: "Sales Team <sales@example.com>" },
          { name: "Subject", value: "Analytics inquiry" },
        ],
      },
    },
    "sales@example.com",
  );
  assert.ok(parsed);
  assert.equal(parsed.fromConnectedMailbox, true);

  const result = await runSync(store.repository, [parsed]);
  assert.equal(result.result.ignored, 1);
  assert.equal(store.ignored.get("self-message"), "sent_by_connected_mailbox");
  assert.equal(store.leads.size, 0);
});

test("does not create a lead when a Gmail message has no sender email", async () => {
  const store = makeRepository();
  const parsed = parseGmailMessage({
    id: "missing-sender-message",
    threadId: "missing-sender-thread",
    payload: {
      headers: [{ name: "Subject", value: "Sales analytics inquiry" }],
      mimeType: "text/plain",
      body: { data: encoded("We need sales analytics.") },
    },
  });
  assert.ok(parsed);

  const result = await runSync(store.repository, [parsed]);
  assert.equal(result.result.ignored, 1);
  assert.equal(store.ignored.get("missing-sender-message"), "missing_sender_email");
  assert.equal(store.leads.size, 0);
  assert.equal(store.messages.size, 0);
  assert.equal(store.processed.size, 0);
});

test("ignored Gmail outcomes are idempotent across repeated syncs", async () => {
  const store = makeRepository();
  const ignoredMessage = {
    ...oneMessage,
    id: "newsletter-message",
    sender: "Newsletter",
    senderEmail: "updates@example.com",
    subject: "Weekly newsletter",
  };
  const first = await runSync(store.repository, [ignoredMessage]);
  const retry = await runSync(store.repository, [ignoredMessage]);

  assert.equal(first.result.ignored, 1);
  assert.equal(retry.result.duplicates, 1);
  assert.equal(retry.result.ignored, 0);
  assert.equal(store.ignored.size, 1);
  assert.equal(store.leads.size, 0);
});

test("does not report sync success when recording an ignored outcome fails", async () => {
  const store = makeRepository();
  const repository: GmailSyncRepository = {
    ...store.repository,
    async recordIgnored() {
      throw new Error("action log persistence failed");
    },
  };
  const ignoredMessage = {
    ...oneMessage,
    sender: null,
    senderEmail: null,
  };

  await assert.rejects(
    runSync(repository, [ignoredMessage]),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "persistence_failure",
  );
  assert.equal(store.leads.size, 0);
  assert.equal(store.messages.size, 0);
  assert.equal(store.ignored.size, 0);
});

test("imports Gmail messages idempotently using provider message IDs", async () => {
  const store = makeRepository();
  const first = await runSync(store.repository, [oneMessage]);
  const retry = await runSync(store.repository, [oneMessage]);

  assert.deepEqual(first.result, { fetched: 1, imported: 1, duplicates: 0, ignored: 0 });
  assert.deepEqual(retry.result, { fetched: 1, imported: 0, duplicates: 1, ignored: 0 });
  assert.equal(store.leads.size, 1);
  assert.equal(store.messages.size, 1);
  assert.ok(store.messages.has("gmail-message-1"));
});

test("links multiple Gmail messages in one thread to one lead", async () => {
  const store = makeRepository();
  const followUp = {
    ...oneMessage,
    id: "gmail-message-2",
    sender: "Different display name",
    senderEmail: "other-address@example.com",
    body: "The same conversation has a follow-up.",
  };
  await runSync(store.repository, [oneMessage, followUp]);

  assert.equal(store.leads.size, 1);
  assert.equal(store.messages.size, 2);
  assert.equal(store.messages.get("gmail-message-1")?.leadId, "lead-1");
  assert.equal(store.messages.get("gmail-message-2")?.leadId, "lead-1");
  assert.equal(store.leads.get("lead-1")?.email, "alex@example.com");
});

test("does not merge different Gmail threads just because sender addresses match", async () => {
  const store = makeRepository();
  const otherThreadMessage = {
    ...oneMessage,
    id: "gmail-message-other-thread",
    threadId: "gmail-thread-other",
  };

  await runSync(store.repository, [oneMessage, otherThreadMessage]);
  assert.equal(store.leads.size, 2);
  assert.equal(store.messages.size, 2);
  assert.notEqual(
    store.messages.get("gmail-message-1")?.leadId,
    store.messages.get("gmail-message-other-thread")?.leadId,
  );
});

test("qualifies and persists a realistic email using its subject and body", async () => {
  const store = makeRepository();
  const message: ParsedGmailMessage = {
    ...oneMessage,
    subject: "Sales and revenue analytics for retail demand",
    body:
      "Hello, we need sales and revenue analytics to forecast retail demand across our stores. Our budget is INR 120,000. Please share next steps.",
  };
  let receivedInquiry = "";

  const result = await runAuthenticatedGmailSync({
    authenticate: async () => ({ userId: "active-representative" }),
    fetchMessages: async () => [message],
    repository: store.repository,
    apiKey: "mock-gemini-key",
    extractFacts: async (request) => {
      receivedInquiry = request.inquiry;
      return {
        requestedService: "sales_revenue_analytics",
        budgetInr: 120_000,
        businessUseCase: "forecast retail demand across our stores",
        genuineBusinessUseCase: true,
        evidence: {
          service: "sales and revenue analytics",
          budgetInr: "Our budget is INR 120,000",
          businessUseCase: "forecast retail demand across our stores",
          genuineBusinessUseCase: "forecast retail demand",
        },
      };
    },
  });

  assert.match(receivedInquiry, /Subject: Sales and revenue analytics for retail demand/);
  assert.match(receivedInquiry, /forecast retail demand across our stores/);
  assert.deepEqual(result.result, { fetched: 1, imported: 1, duplicates: 0, ignored: 0 });
  assert.equal(store.leads.size, 1);
  assert.equal(store.leads.get("lead-1")?.status, "qualified");
  assert.equal(store.messages.size, 1);
  assert.equal(store.processed.size, 1);
});

test("uses sender email as identity without inventing a display name", async () => {
  const store = makeRepository();
  const message = { ...oneMessage, sender: null };

  await runSync(store.repository, [message]);
  assert.equal(store.leads.get("lead-1")?.fullName, "alex@example.com");
  assert.notEqual(store.leads.get("lead-1")?.fullName, "Unnamed");
});

test("leaves incomplete business information at follow-up status", async () => {
  const store = makeRepository();
  const result = await runAuthenticatedGmailSync({
    authenticate: async () => ({ userId: "active-representative" }),
    fetchMessages: async () => [oneMessage],
    repository: store.repository,
    apiKey: "mock-gemini-key",
    extractFacts: async () => ({
      ...facts,
      budgetInr: null,
      evidence: { ...facts.evidence, budgetInr: null },
    }),
  });

  assert.equal(result.result.imported, 1);
  assert.equal(store.leads.get("lead-1")?.status, "follow_up");
});

test("does not persist or report success when an incoming email fails qualification", async () => {
  const store = makeRepository();
  const message: ParsedGmailMessage = {
    ...oneMessage,
    subject: "Sales analytics for retail forecasting",
    body: "We need sales analytics to forecast retail demand. Budget is INR 120,000.",
  };

  await assert.rejects(
    runAuthenticatedGmailSync({
      authenticate: async () => ({ userId: "active-representative" }),
      fetchMessages: async () => [message],
      repository: store.repository,
      apiKey: "mock-gemini-key",
      extractFacts: async () => ({
        requestedService: "sales_revenue_analytics",
        budgetInr: "120000",
      }),
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("Could not qualify an incoming email") &&
      error.message.includes("invalid type or value"),
  );

  assert.equal(store.leads.size, 0);
  assert.equal(store.messages.size, 0);
  assert.equal(store.processed.size, 0);
});

test("preserves a Gemini quota failure and leaves Gmail records unprocessed", async () => {
  const extractorFailureRepository = makeRepository();
  await assert.rejects(
    runAuthenticatedGmailSync({
      authenticate: async () => ({ userId: "active-representative" }),
      fetchMessages: async () => [oneMessage],
      repository: extractorFailureRepository.repository,
      apiKey: "mock-gemini-key",
      extractFacts: async () => {
        throw new QualificationError(
          "model_unavailable",
          "Gemini API returned HTTP 429. Gemini quota or rate limit was reached. Check API usage and quota.",
        );
      },
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("HTTP 429") &&
      error.message.includes("quota or rate limit"),
  );
  assert.equal(extractorFailureRepository.leads.size, 0);
  assert.equal(extractorFailureRepository.messages.size, 0);
  assert.equal(extractorFailureRepository.processed.size, 0);
});

test("timeout during qualification leaves Gmail records unpersisted", async () => {
  const store = makeRepository();
  await assert.rejects(
    runAuthenticatedGmailSync({
      authenticate: async () => ({ userId: "timeout-test-representative" }),
      fetchMessages: async () => [oneMessage],
      repository: store.repository,
      apiKey: "mock-gemini-key",
      extractFacts: async () => {
        throw new QualificationError(
          "model_unavailable",
          "Gemini request timed out or was aborted. Gemini timed out. Check connectivity and try again later.",
        );
      },
    }),
    /timed out or was aborted/,
  );
  assert.equal(store.leads.size, 0);
  assert.equal(store.messages.size, 0);
  assert.equal(store.processed.size, 0);
});

test("rejects an overlapping sync for the same representative", async () => {
  const store = makeRepository();
  let signalStarted: () => void = () => {};
  let releaseFetch: () => void = () => {};
  const fetchStarted = new Promise<void>((resolve) => {
    signalStarted = resolve;
  });
  const fetchGate = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  let fetchCount = 0;
  const first = runAuthenticatedGmailSync({
    authenticate: async () => ({ userId: "overlap-test-representative" }),
    fetchMessages: async () => {
      fetchCount += 1;
      signalStarted();
      await fetchGate;
      return [oneMessage];
    },
    repository: store.repository,
    apiKey: "mock-gemini-key",
    extractFacts: async () => facts,
  });
  await fetchStarted;

  await assert.rejects(
    runAuthenticatedGmailSync({
      authenticate: async () => ({ userId: "overlap-test-representative" }),
      fetchMessages: async () => {
        fetchCount += 1;
        return [oneMessage];
      },
      repository: store.repository,
      apiKey: "mock-gemini-key",
      extractFacts: async () => facts,
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "sync_in_progress",
  );

  releaseFetch();
  await first;
  assert.equal(fetchCount, 1);
  assert.equal(store.leads.size, 1);
  assert.equal(store.messages.size, 1);
});

test("rejects authentication failure before requesting Gmail messages", async () => {
  const store = makeRepository();
  let requestedMailbox = false;
  await assert.rejects(
    runAuthenticatedGmailSync({
      authenticate: async () => {
        throw new Error("unauthorized");
      },
      fetchMessages: async () => {
        requestedMailbox = true;
        return [oneMessage];
      },
      repository: store.repository,
      apiKey: "mock-gemini-key",
      extractFacts: async () => facts,
    }),
    /unauthorized/,
  );
  assert.equal(requestedMailbox, false);
  assert.equal(store.messages.size, 0);
});

test("does not persist messages when Gmail API retrieval fails", async () => {
  const store = makeRepository();
  await assert.rejects(
    runAuthenticatedGmailSync({
      authenticate: async () => ({ userId: "active-representative" }),
      fetchMessages: async () => {
        throw new Error("Gmail API unavailable");
      },
      repository: store.repository,
      apiKey: "mock-gemini-key",
      extractFacts: async () => facts,
    }),
    /Gmail API unavailable/,
  );
  assert.equal(store.messages.size, 0);
  assert.equal(store.leads.size, 0);
});

test("rolls back lead and message writes when processed metadata persistence fails", async () => {
  const store = makeRepository();
  const repository: GmailSyncRepository = {
    ...store.repository,
    async recordProcessed() {
      throw new Error("action log write failed");
    },
  };

  await assert.rejects(
    runSync(repository, [oneMessage]),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes("could not be fully saved"),
  );
  assert.equal(store.messages.size, 0);
  assert.equal(store.leads.size, 0);
  assert.equal(store.processed.size, 0);
});

test("does not delete an existing duplicate message after a unique-key conflict", async () => {
  const store = makeRepository();
  store.messages.set("gmail-message-1", {
    leadId: "already-saved-lead",
    body: oneMessage.body,
    sentAt: oneMessage.sentAt,
  });
  store.leads.set("already-saved-lead", {
    id: "already-saved-lead",
    status: "new",
    fullName: "Alex Customer",
    email: "alex@example.com",
  });
  const repository: GmailSyncRepository = {
    ...store.repository,
    async findMessage() {
      return null;
    },
    async insertMessage() {
      throw new Error("unique provider id");
    },
  };

  await assert.rejects(runSync(repository, [oneMessage]));
  assert.equal(store.messages.has("gmail-message-1"), true);
  assert.equal(store.leads.has("already-saved-lead"), true);
});
