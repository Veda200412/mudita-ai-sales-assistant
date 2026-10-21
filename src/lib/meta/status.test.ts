import assert from "node:assert/strict";
import test from "node:test";
import { createMetaChannelStatus } from "@/lib/meta/status";

const now = Date.parse("2026-01-02T12:00:00.000Z");

test("Meta channel status reports missing configuration without exposing values", () => {
  assert.deepEqual(
    createMetaChannelStatus({
      channel: "instagram",
      missingVariables: ["META_APP_SECRET"],
      lastWebhookEventAt: null,
      now,
    }),
    {
      channel: "instagram",
      status: "configuration_missing",
      configured: false,
      missingVariables: ["META_APP_SECRET"],
      lastWebhookEventAt: null,
    },
  );
});

test("configured Meta channel is not called live until a webhook event is persisted", () => {
  const result = createMetaChannelStatus({
    channel: "whatsapp",
    missingVariables: [],
    lastWebhookEventAt: null,
    now,
  });
  assert.equal(result.status, "configured_unverified");
  assert.equal(result.configured, true);
});

test("recent and older persisted webhook events have distinct statuses", () => {
  const recent = createMetaChannelStatus({
    channel: "instagram",
    missingVariables: [],
    lastWebhookEventAt: "2026-01-02T11:30:00.000Z",
    now,
  });
  const older = createMetaChannelStatus({
    channel: "whatsapp",
    missingVariables: [],
    lastWebhookEventAt: "2025-12-31T11:00:00.000Z",
    now,
  });
  assert.equal(recent.status, "webhook_received_recently");
  assert.equal(older.status, "webhook_received");
  assert.equal(recent.lastWebhookEventAt, "2026-01-02T11:30:00.000Z");
});
