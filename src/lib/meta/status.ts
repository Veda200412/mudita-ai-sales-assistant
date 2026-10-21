export type MetaIntegrationStatus =
  | "configuration_missing"
  | "configured_unverified"
  | "webhook_received"
  | "webhook_received_recently";

export interface MetaChannelStatus {
  channel: "instagram" | "whatsapp";
  status: MetaIntegrationStatus;
  configured: boolean;
  missingVariables: string[];
  lastWebhookEventAt: string | null;
}

const RECENT_EVENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function createMetaChannelStatus(input: {
  channel: "instagram" | "whatsapp";
  missingVariables: string[];
  lastWebhookEventAt: string | null;
  now?: number;
}): MetaChannelStatus {
  const configured = input.missingVariables.length === 0;
  const eventTime = input.lastWebhookEventAt
    ? Date.parse(input.lastWebhookEventAt)
    : Number.NaN;
  const now = input.now ?? Date.now();
  const recent =
    Number.isFinite(eventTime) &&
    eventTime <= now &&
    now - eventTime <= RECENT_EVENT_WINDOW_MS;

  return {
    channel: input.channel,
    configured,
    missingVariables: [...input.missingVariables],
    lastWebhookEventAt: input.lastWebhookEventAt,
    status: !configured
      ? "configuration_missing"
      : recent
        ? "webhook_received_recently"
        : input.lastWebhookEventAt
          ? "webhook_received"
          : "configured_unverified",
  };
}
