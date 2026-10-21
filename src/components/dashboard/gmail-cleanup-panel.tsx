"use client";

import { useMemo, useState } from "react";

type CleanupCategory =
  | "likely_non_sales"
  | "potential_genuine_inquiry"
  | "needs_manual_review";

interface CleanupPreviewItem {
  leadId: string;
  fullName: string | null;
  email: string | null;
  category: CleanupCategory;
  reasons: string[];
  messageIds: string[];
  messageCount: number;
}

interface CleanupPreview {
  previewId: string;
  items: CleanupPreviewItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPreview(value: unknown): CleanupPreview | null {
  if (
    !isRecord(value) ||
    typeof value.previewId !== "string" ||
    !Array.isArray(value.items)
  ) {
    return null;
  }
  const items: CleanupPreviewItem[] = [];
  for (const item of value.items) {
    if (
      !isRecord(item) ||
      typeof item.leadId !== "string" ||
      ![
        "likely_non_sales",
        "potential_genuine_inquiry",
        "needs_manual_review",
      ].includes(String(item.category)) ||
      !Array.isArray(item.reasons) ||
      !item.reasons.every((reason) => typeof reason === "string") ||
      !Array.isArray(item.messageIds) ||
      !item.messageIds.every((id) => typeof id === "string") ||
      typeof item.messageCount !== "number"
    ) {
      return null;
    }
    items.push({
      leadId: item.leadId,
      fullName: typeof item.fullName === "string" ? item.fullName : null,
      email: typeof item.email === "string" ? item.email : null,
      category: item.category as CleanupCategory,
      reasons: item.reasons,
      messageIds: item.messageIds,
      messageCount: item.messageCount,
    });
  }
  return { previewId: value.previewId, items };
}

const categoryLabels: Record<CleanupCategory, string> = {
  likely_non_sales: "Likely non-sales / automated",
  potential_genuine_inquiry: "Potential genuine inquiry — preserve",
  needs_manual_review: "Needs manual review — no change",
};

const reasonLabels: Record<string, string> = {
  sent_by_connected_mailbox: "Sent from the connected mailbox",
  automated_header: "Gmail automation, list, or bulk headers",
  automated_sender: "Automated sender address",
  job_alert: "Job alert or Glassdoor indicator",
  newsletter_or_notification: "Notification or digest subject",
};

export function GmailCleanupPanel({
  accessToken,
  onUpdated,
}: {
  accessToken: string;
  onUpdated: () => void;
}) {
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  const likelyItems = useMemo(
    () =>
      preview?.items.filter(
        (item) => item.category === "likely_non_sales",
      ) ?? [],
    [preview],
  );

  async function createPreview() {
    setIsPreviewing(true);
    setError(null);
    setNotice(null);
    setPreview(null);
    setSelectedIds([]);
    try {
      const response = await fetch("/api/gmail/cleanup/preview", {
        method: "POST",
        headers: { Authorization: "Bearer " + accessToken },
        cache: "no-store",
      });
      const body: unknown = await response.json();
      const result = readPreview(body);
      if (!response.ok || !result) {
        setError(
          isRecord(body) && typeof body.error === "string"
            ? body.error
            : "A cleanup preview could not be loaded.",
        );
        return;
      }
      setPreview(result);
      setSelectedIds(
        result.items
          .filter((item) => item.category === "likely_non_sales")
          .map((item) => item.leadId),
      );
    } catch {
      setError("Could not reach the Gmail cleanup preview endpoint.");
    } finally {
      setIsPreviewing(false);
    }
  }

  async function confirmCleanup() {
    if (!preview || selectedIds.length === 0) return;
    setIsConfirming(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/gmail/cleanup/confirm", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          previewId: preview.previewId,
          selectedLeadIds: selectedIds,
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok || !isRecord(body)) {
        setError(
          isRecord(body) && typeof body.error === "string"
            ? body.error
            : "Cleanup could not be confirmed.",
        );
        return;
      }
      if (body.alreadyConfirmed === true) {
        setNotice("This preview was already confirmed. No records were changed again.");
      } else {
        const count =
          typeof body.ignored === "number" ? body.ignored : selectedIds.length;
        setNotice(
          String(count) +
            " lead(s) marked ignored. Messages and conversation history were retained.",
        );
      }
      setPreview(null);
      setSelectedIds([]);
      onUpdated();
    } catch {
      setError("Could not reach the Gmail cleanup confirmation endpoint.");
    } finally {
      setIsConfirming(false);
    }
  }

  return (
    <div className="gmail-cleanup-panel">
      <div className="gmail-cleanup-heading">
        <div>
          <h3>Review existing Gmail leads</h3>
          <p>
            Preview classifies stored Gmail records only. Nothing is changed
            until you confirm selected likely non-sales records. Confirmed
            records are hidden from Leads; their status, evidence, messages,
            and thread history remain unchanged.
          </p>
        </div>
        <button
          className="quiet-button"
          type="button"
          onClick={() => void createPreview()}
          disabled={isPreviewing || isConfirming}
        >
          {isPreviewing ? "Preparing preview…" : "Preview cleanup"}
        </button>
      </div>
      {error ? <p className="gmail-message error" role="alert">{error}</p> : null}
      {notice ? <p className="gmail-message" role="status">{notice}</p> : null}
      {preview ? (
        <div className="gmail-cleanup-results">
          <p className="gmail-cleanup-summary">
            {likelyItems.length} likely non-sales ·{" "}
            {preview.items.filter((item) => item.category === "potential_genuine_inquiry").length}{" "}
            potential inquiries ·{" "}
            {preview.items.filter((item) => item.category === "needs_manual_review").length}{" "}
            need manual review
          </p>
          {preview.items.length === 0 ? (
            <p className="gmail-cleanup-empty">No existing Gmail leads need review.</p>
          ) : (
            <ul className="gmail-cleanup-list">
              {preview.items.map((item) => (
                <li className="gmail-cleanup-item" key={item.leadId}>
                  <label className="gmail-cleanup-choice">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.leadId)}
                      disabled={
                        item.category !== "likely_non_sales" ||
                        isConfirming
                      }
                      onChange={(event) => {
                        setSelectedIds((current) =>
                          event.target.checked
                            ? [...current, item.leadId]
                            : current.filter((id) => id !== item.leadId),
                        );
                      }}
                    />
                    <span className={["gmail-cleanup-category", item.category].join(" ")}>
                      {categoryLabels[item.category]}
                    </span>
                    <span className="gmail-cleanup-person">
                      {item.fullName ?? "Unnamed lead"}
                      {item.email ? " · " + item.email : ""}
                    </span>
                    <span className="gmail-cleanup-detail">
                      {item.messageCount} message(s)
                      {item.reasons.length
                        ? " · " +
                          item.reasons
                            .map((reason) => reasonLabels[reason] ?? "Automated/non-sales signal")
                            .join(", ")
                        : item.category === "potential_genuine_inquiry"
                          ? " · No automated/non-sales signal; preserve for qualification."
                          : " · Message metadata is incomplete; review manually."}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {likelyItems.length > 0 ? (
            <div className="gmail-cleanup-confirm">
              <span>
                {selectedIds.length} likely non-sales record(s) selected.
                Potential inquiries and manual-review records cannot be selected.
              </span>
              <button
                className="primary-button"
                type="button"
                onClick={() => void confirmCleanup()}
                disabled={selectedIds.length === 0 || isConfirming}
              >
                {isConfirming
                  ? "Confirming cleanup…"
                  : "Confirm: mark " + selectedIds.length + " ignored"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
