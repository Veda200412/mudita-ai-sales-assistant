"use client";

import { useCallback, useEffect, useState } from "react";
import { Instagram, MessageCircle, RefreshCw } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import type {
  MetaChannelStatus,
  MetaIntegrationStatus as MetaIntegrationStatusCode,
} from "@/lib/meta/status";

interface MetaStatusResponse {
  callbackPath: string;
  channels: MetaChannelStatus[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStatus(value: unknown): value is MetaIntegrationStatusCode {
  return [
    "configuration_missing",
    "configured_unverified",
    "webhook_received",
    "webhook_received_recently",
  ].includes(String(value));
}

function readStatus(value: unknown): MetaStatusResponse | null {
  if (
    !isRecord(value) ||
    value.callbackPath !== "/api/meta/webhook" ||
    !Array.isArray(value.channels)
  ) {
    return null;
  }
  const channels: MetaChannelStatus[] = [];
  for (const item of value.channels) {
    if (
      !isRecord(item) ||
      (item.channel !== "instagram" && item.channel !== "whatsapp") ||
      !isStatus(item.status) ||
      typeof item.configured !== "boolean" ||
      !Array.isArray(item.missingVariables) ||
      !item.missingVariables.every((name) => typeof name === "string") ||
      (item.lastWebhookEventAt !== null &&
        typeof item.lastWebhookEventAt !== "string")
    ) {
      return null;
    }
    channels.push({
      channel: item.channel,
      status: item.status,
      configured: item.configured,
      missingVariables: item.missingVariables,
      lastWebhookEventAt: item.lastWebhookEventAt,
    });
  }
  return { callbackPath: value.callbackPath, channels };
}

function statusLabel(status: MetaChannelStatus["status"]): string {
  switch (status) {
    case "configuration_missing":
      return "Configuration missing";
    case "configured_unverified":
      return "Configured · delivery unverified";
    case "webhook_received":
      return "Event received";
    case "webhook_received_recently":
      return "Event received recently";
  }
}

export function MetaIntegrationStatus({ accessToken }: { accessToken: string }) {
  const [status, setStatus] = useState<MetaStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/meta/status", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const body: unknown = await response.json();
      const result = readStatus(body);
      if (!response.ok || !result) {
        setError(
          isRecord(body) && typeof body.error === "string"
            ? body.error
            : "Meta integration status could not be loaded.",
        );
        return;
      }
      setStatus(result);
      setError(null);
    } catch {
      setError("Meta integration status could not be loaded. Check connectivity.");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SectionCard
      title="Meta inbound integrations"
      description="Inbound webhooks only; receiving an event is not a connection check."
    >
      <div className="meta-integration-grid">
        {(["instagram", "whatsapp"] as const).map((channel) => {
          const item = status?.channels.find((entry) => entry.channel === channel);
          const isRecent = item?.status === "webhook_received_recently";
          return (
            <article className="meta-integration-item" key={channel}>
              <div className="meta-integration-heading">
                {channel === "instagram" ? (
                  <Instagram aria-hidden="true" size={17} />
                ) : (
                  <MessageCircle aria-hidden="true" size={17} />
                )}
                <strong>{channel === "instagram" ? "Instagram" : "WhatsApp"}</strong>
                <span className={`gmail-status${isRecent ? " connected" : ""}`} role="status">
                  {loading && !item ? "Checking" : item ? statusLabel(item.status) : "Unavailable"}
                </span>
              </div>
              <p className="meta-integration-copy">
                {item?.status === "configuration_missing"
                  ? `Missing: ${item.missingVariables.join(", ")}`
                  : item?.lastWebhookEventAt
                    ? `Last webhook event: ${new Date(item.lastWebhookEventAt).toLocaleString()}`
                    : "No persisted webhook event yet; test delivery from Meta."}
              </p>
            </article>
          );
        })}
      </div>
      <div className="meta-integration-footer">
        <span>Callback URL path: <code>/api/meta/webhook</code></span>
        <button
          className="quiet-button"
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh Meta integration status"
        >
          <RefreshCw aria-hidden="true" className={loading ? "spin" : ""} size={14} />
          Refresh
        </button>
      </div>
      {error && <p className="gmail-message error" role="alert">{error}</p>}
      <p className="meta-integration-guidance">
        Configure <code>META_APP_SECRET</code> and <code>META_VERIFY_TOKEN</code>, subscribe each product to messages, then send a real test message. Status reflects persisted inbound events, not token presence.
      </p>
    </SectionCard>
  );
}
