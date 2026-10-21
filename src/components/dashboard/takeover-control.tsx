"use client";

import { useCallback, useEffect, useState } from "react";
import { Hand, ShieldCheck } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";

interface TakeoverState {
  takeoverActive: boolean;
  partiallyActive: boolean;
  leadTakeoverActive?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function TakeoverControl({
  accessToken,
  leadId,
}: {
  accessToken: string;
  leadId: string | null;
}) {
  const [state, setState] = useState<TakeoverState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    try {
      const query = leadId ? `?leadId=${encodeURIComponent(leadId)}` : "";
      const response = await fetch(`/api/automation/takeover${query}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const body: unknown = await response.json();
      if (
        !response.ok ||
        !isRecord(body) ||
        typeof body.takeoverActive !== "boolean" ||
        typeof body.partiallyActive !== "boolean"
      ) {
        setError(
          isRecord(body) && typeof body.error === "string"
            ? body.error
            : "Takeover state could not be loaded.",
        );
        return;
      }
      setState({
        takeoverActive: body.takeoverActive,
        partiallyActive: body.partiallyActive,
        leadTakeoverActive:
          typeof body.leadTakeoverActive === "boolean"
            ? body.leadTakeoverActive
            : false,
      });
      setError(null);
    } catch {
      setError("Takeover state could not be loaded. Check your connection.");
    }
  }, [accessToken, leadId]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  async function setTakeover(takeover: boolean, scope: "workspace" | "lead") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/automation/takeover", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          takeover,
          scope,
          ...(scope === "lead" ? { leadId } : {}),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        setError(
          isRecord(body) && typeof body.error === "string"
            ? body.error
            : "Takeover state could not be updated.",
        );
        return;
      }
      await loadState();
    } catch {
      setError("Takeover state could not be updated. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const takeoverOn = state?.takeoverActive ?? false;
  const leadTakeoverOn = state?.leadTakeoverActive ?? false;

  return (
    <SectionCard title="Human takeover" description="Pause automated actions and let a person respond.">
      <div className="takeover-state">
        <span className="takeover-icon"><Hand aria-hidden="true" size={17} /></span>
        <div className="takeover-copy">
          <span className="takeover-label">
            Workspace: {takeoverOn ? "Takeover is on" : state?.partiallyActive ? "Partially paused" : "Automation is available"}
          </span>
          <span className="takeover-help">
            {state
              ? "Pauses automated actions across email, Instagram, and WhatsApp."
              : "Loading persisted workspace setting…"}
          </span>
        </div>
        <button
          className={`toggle-switch${takeoverOn ? " is-on" : ""}`}
          type="button"
          role="switch"
          aria-checked={takeoverOn}
          aria-label="Pause workspace automation"
          disabled={busy || !state}
          onClick={() => void setTakeover(!takeoverOn, "workspace")}
        >
          <span />
        </button>
      </div>
      {leadId && (
        <div className="takeover-state takeover-lead-state">
          <span className="takeover-icon"><Hand aria-hidden="true" size={17} /></span>
          <div className="takeover-copy">
            <span className="takeover-label">
              Selected lead: {leadTakeoverOn ? "Takeover is on" : "No lead override"}
            </span>
            <span className="takeover-help">Pause automated actions for this lead only.</span>
          </div>
          <button
            className={`toggle-switch${leadTakeoverOn ? " is-on" : ""}`}
            type="button"
            role="switch"
            aria-checked={leadTakeoverOn}
            aria-label="Pause automation for selected lead"
            disabled={busy || !state || takeoverOn}
            onClick={() => void setTakeover(!leadTakeoverOn, "lead")}
          >
            <span />
          </button>
        </div>
      )}
      <div className="takeover-notice">
        <ShieldCheck aria-hidden="true" size={15} />
        <span>
          Incoming Gmail messages continue to be saved. Human-initiated actions remain available.
        </span>
      </div>
      {error && <p className="takeover-error" role="alert">{error}</p>}
    </SectionCard>
  );
}
