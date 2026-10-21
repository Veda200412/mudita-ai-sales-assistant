"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, RefreshCw } from "lucide-react";
import { GmailCleanupPanel } from "@/components/dashboard/gmail-cleanup-panel";

interface GmailStatus {
  configured: boolean;
  connected: boolean;
  lastSuccessfulSync: string | null;
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStatus(value: unknown): GmailStatus | null {
  if (
    !isRecord(value) ||
    typeof value.configured !== "boolean" ||
    typeof value.connected !== "boolean" ||
    (value.lastSuccessfulSync !== null &&
      typeof value.lastSuccessfulSync !== "string") ||
    (value.error !== null && typeof value.error !== "string")
  ) {
    return null;
  }
  return {
    configured: value.configured,
    connected: value.connected,
    lastSuccessfulSync: value.lastSuccessfulSync,
    error: value.error,
  };
}

export function GmailIntegrationCard({
  accessToken,
  onSynced,
}: {
  accessToken: string;
  onSynced: () => void;
}) {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/gmail/status", {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const body: unknown = await response.json();
      const result = readStatus(body);
      if (!response.ok || !result) {
        setError(
          isRecord(body) && typeof body.error === "string"
            ? body.error
            : "Gmail status could not be loaded.",
        );
        return;
      }
      setStatus(result);
      setError(result.error);
    } catch {
      setError("Could not reach the Gmail status endpoint.");
    } finally {
      setIsLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const oauthResult = query.get("gmail");
    if (oauthResult) {
      setNotice(
        oauthResult === "connected"
          ? "Google authorization completed. Your mailbox is connected."
          : "Google authorization did not complete. Review the setup and try again.",
      );
      window.history.replaceState({}, "", window.location.pathname);
    }
    void loadStatus();
  }, [loadStatus]);

  async function connectMailbox() {
    setIsConnecting(true);
    setError(null);
    try {
      const response = await fetch("/api/gmail/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body: unknown = await response.json();
      if (
        !response.ok ||
        !isRecord(body) ||
        typeof body.authorizationUrl !== "string"
      ) {
        setError(
          isRecord(body) && typeof body.error === "string"
            ? body.error
            : "Gmail connection could not be started.",
        );
        return;
      }
      window.location.assign(body.authorizationUrl);
    } catch {
      setError("Could not start Google authorization.");
    } finally {
      setIsConnecting(false);
    }
  }

  async function syncMailbox() {
    setIsSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/gmail/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body: unknown = await response.json();
      if (!response.ok || !isRecord(body)) {
        setError(
          isRecord(body) && typeof body.error === "string"
            ? body.error
            : "Gmail synchronization failed.",
        );
        await loadStatus();
        return;
      }
      setNotice(
        `Sync complete: ${typeof body.imported === "number" ? body.imported : 0} new message(s), ${typeof body.ignored === "number" ? body.ignored : 0} ignored as non-sales/automated, ${typeof body.duplicates === "number" ? body.duplicates : 0} already processed.`,
      );
      await loadStatus();
      onSynced();
    } catch {
      setError("Could not reach the Gmail synchronization endpoint.");
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <section className="gmail-card" aria-labelledby="gmail-title">
      <div className="gmail-card-heading">
        <span className="gmail-card-icon">
          <Mail aria-hidden="true" size={18} />
        </span>
        <div>
          <p className="eyebrow">Inbound channel</p>
          <h2 id="gmail-title">Gmail integration</h2>
        </div>
        <span
          className={`gmail-status ${status?.connected ? "connected" : ""}`}
          role="status"
        >
          {isLoading
            ? "Checking"
            : status?.connected
              ? "Connected"
              : "Not connected"}
        </span>
      </div>
      <p className="gmail-card-copy">
        Read-only inbox polling. Emails are qualified and saved to the
        authenticated Supabase workspace; no replies are sent.
      </p>
      <div className="gmail-card-meta">
        <span>Last successful sync</span>
        <strong>
          {status?.lastSuccessfulSync
            ? new Date(status.lastSuccessfulSync).toLocaleString()
            : "Never"}
        </strong>
      </div>
      {error ? (
        <p className="gmail-message error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="gmail-message" role="status">
          {notice}
        </p>
      ) : null}
      <div className="gmail-card-actions">
        {status?.connected ? (
          <button
            className="primary-button"
            type="button"
            onClick={() => void syncMailbox()}
            disabled={isSyncing || isLoading}
          >
            <RefreshCw
              aria-hidden="true"
              className={isSyncing ? "spin" : ""}
              size={15}
            />
            {isSyncing ? "Syncing email…" : "Sync email"}
          </button>
        ) : (
          <button
            className="primary-button"
            type="button"
            onClick={() => void connectMailbox()}
            disabled={!status?.configured || isConnecting || isLoading}
          >
            <Mail aria-hidden="true" size={15} />
            {isConnecting ? "Connecting…" : "Connect Gmail"}
          </button>
        )}
        {status?.connected ? (
          <button
            className="quiet-button"
            type="button"
            onClick={() => void loadStatus()}
            disabled={isLoading || isSyncing}
          >
            Refresh status
          </button>
        ) : null}
      </div>
      {status?.connected ? (
        <GmailCleanupPanel
          accessToken={accessToken}
          onUpdated={onSynced}
        />
      ) : null}
    </section>
  );
}
