"use client";

import { useState } from "react";
import { AlertCircle, Beaker, LoaderCircle, Sparkles } from "lucide-react";
import {
  qualificationStatuses,
} from "@/lib/policy";
import type { QualificationResponse } from "@/lib/qualification";

interface QualificationTestPanelProps {
  accessToken: string;
  onLeadSaved: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isQualificationResponse(
  value: unknown,
): value is QualificationResponse {
  const validStatus =
    typeof value === "object" &&
    value !== null &&
    "finalStatus" in value &&
    typeof value.finalStatus === "string" &&
    qualificationStatuses.some((status) => status === value.finalStatus);
  return (
    isRecord(value) &&
    isRecord(value.extractedFacts) &&
    isRecord(value.evidence) &&
    validStatus &&
    Array.isArray(value.missingInformation) &&
    typeof value.reason === "string"
  );
}

export function QualificationTestPanel({
  accessToken,
  onLeadSaved,
}: QualificationTestPanelProps) {
  const [inquiry, setInquiry] = useState("");
  const [channel, setChannel] = useState<
    "" | "instagram" | "whatsapp" | "email"
  >("");
  const [result, setResult] = useState<QualificationResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [savedLeadId, setSavedLeadId] = useState<string | null>(null);
  const [savedActionLogRecorded, setSavedActionLogRecorded] = useState<
    boolean | null
  >(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/leads/qualify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ inquiry }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message =
          isRecord(body) && typeof body.error === "string"
            ? body.error
            : "Qualification could not be completed. Please try again.";
        setErrorMessage(message);
        return;
      }
      if (!isQualificationResponse(body)) {
        setErrorMessage("The qualification response was invalid. Please retry.");
        return;
      }
      setResult(body);
    } catch {
      setErrorMessage("Could not reach the qualification endpoint. Please retry.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSaveAsLead() {
    if (!channel) return;
    setErrorMessage(null);
    setIsSaving(true);
    const requestKey = idempotencyKey ?? crypto.randomUUID();
    setIdempotencyKey(requestKey);

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Idempotency-Key": requestKey,
        },
        body: JSON.stringify({ inquiry, channel }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message =
          isRecord(body) && typeof body.error === "string"
            ? body.error
            : "The inquiry could not be saved. Please try again.";
        setErrorMessage(message);
        return;
      }
      if (!isRecord(body) || typeof body.leadId !== "string") {
        setErrorMessage("The save response was invalid. Please retry.");
        return;
      }
      if (typeof body.actionLogRecorded !== "boolean") {
        setErrorMessage("The save response was incomplete. Please retry.");
        return;
      }
      setSavedLeadId(body.leadId);
      setSavedActionLogRecorded(body.actionLogRecorded);
      setIdempotencyKey(null);
      onLeadSaved();
    } catch {
      setErrorMessage("Could not reach the save endpoint. Please retry.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="qualification-test-panel" aria-labelledby="qualification-test-title">
      <div className="qualification-test-heading">
        <span className="qualification-test-icon">
          <Beaker aria-hidden="true" size={17} />
        </span>
        <div>
          <h2 id="qualification-test-title">Qualification test panel</h2>
          <p>Test the policy with an inquiry. This is not a live conversation.</p>
        </div>
        <span className="test-only-badge">TEST ONLY</span>
      </div>

      <form className="qualification-test-form" onSubmit={handleSubmit}>
        <label htmlFor="qualification-inquiry">Customer inquiry</label>
        <textarea
          id="qualification-inquiry"
          value={inquiry}
          onChange={(event) => {
            setInquiry(event.target.value);
            setResult(null);
            setIdempotencyKey(null);
            setSavedLeadId(null);
            setSavedActionLogRecorded(null);
          }}
          maxLength={6000}
          placeholder="Example: We need sales and revenue analytics for our retail branches. Our budget is INR 75,000."
          required
          rows={4}
        />
        <div className="qualification-form-footer">
          <span>{inquiry.length}/6000 characters · Analysis does not save or send</span>
          <button type="submit" disabled={isSubmitting || inquiry.trim().length === 0}>
            {isSubmitting ? (
              <LoaderCircle aria-hidden="true" className="spin" size={15} />
            ) : (
              <Sparkles aria-hidden="true" size={15} />
            )}
            {isSubmitting ? "Analyzing…" : "Analyze inquiry"}
          </button>
        </div>
      </form>

      {errorMessage ? (
        <div className="qualification-error" role="alert">
          <AlertCircle aria-hidden="true" size={16} />
          <span>{errorMessage}</span>
        </div>
      ) : null}

      {result ? (
        <div className="qualification-result" aria-live="polite">
          <div className="qualification-result-heading">
            <h3>Test result</h3>
            <span className={`qualification-result-status ${result.finalStatus}`}>
              {result.finalStatus.replaceAll("_", " ")}
            </span>
          </div>
          <dl className="qualification-facts-grid">
            <div>
              <dt>Requested service</dt>
              <dd>{result.extractedFacts.requestedService ?? "Not identified"}</dd>
            </div>
            <div>
              <dt>Budget</dt>
              <dd>
                {result.extractedFacts.budgetInr === null
                  ? "Not identified"
                  : `INR ${result.extractedFacts.budgetInr.toLocaleString("en-IN")}`}
              </dd>
            </div>
            <div>
              <dt>Business use case</dt>
              <dd>{result.extractedFacts.businessUseCase ?? "Not identified"}</dd>
            </div>
            <div>
              <dt>Genuine business use case</dt>
              <dd>
                {result.extractedFacts.genuineBusinessUseCase === null
                  ? "Not determined"
                  : result.extractedFacts.genuineBusinessUseCase
                    ? "Yes"
                    : "No"}
              </dd>
            </div>
          </dl>
          <div className="qualification-evidence">
            <h4>Supporting evidence</h4>
            {Object.entries(result.evidence).some(([, evidence]) => evidence) ? (
              <ul>
                {Object.entries(result.evidence).map(([field, evidence]) =>
                  evidence ? (
                    <li key={field}>
                      <span>{field.replaceAll(/([A-Z])/g, " $1")}</span>
                      <q>{evidence}</q>
                    </li>
                  ) : null,
                )}
              </ul>
            ) : (
              <p>No verified evidence excerpts were identified.</p>
            )}
          </div>
          <div className="qualification-missing">
            <h4>Missing information</h4>
            {result.missingInformation.length > 0 ? (
              <ul>
                {result.missingInformation.map((field) => (
                  <li key={field}>{field.replaceAll(/([A-Z])/g, " $1")}</li>
                ))}
              </ul>
            ) : (
              <p>No required information is missing.</p>
            )}
          </div>
          <p className="qualification-policy-note">
            Final status is determined by the configured business policy, not Gemini.
          </p>
        </div>
      ) : null}

      <div className="save-inquiry-action">
        <p>
          Saving creates a real lead record and stores this inquiry in your
          workspace. Use only for a genuine customer inquiry.
        </p>
        <div className="save-inquiry-controls">
          <label htmlFor="inquiry-channel">Customer inquiry source</label>
          <select
            id="inquiry-channel"
            required
            value={channel}
            onChange={(event) => {
              const selectedChannel = event.target.value;
              if (
                selectedChannel === "" ||
                selectedChannel === "instagram" ||
                selectedChannel === "whatsapp" ||
                selectedChannel === "email"
              ) {
                setChannel(selectedChannel);
              }
              setIdempotencyKey(null);
              setSavedLeadId(null);
              setSavedActionLogRecorded(null);
            }}
          >
            <option value="">Select source channel</option>
            <option value="email">Email</option>
            <option value="instagram">Instagram</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
          <button
            type="button"
            onClick={handleSaveAsLead}
            disabled={
              isSaving ||
              savedLeadId !== null ||
              channel === "" ||
              inquiry.trim().length === 0 ||
              result === null
            }
          >
            {isSaving
              ? "Saving…"
              : savedLeadId
                ? "Saved as lead"
                : "Save this inquiry as a real lead"}
          </button>
        </div>
        {savedLeadId ? (
          <p role="status">
            {savedActionLogRecorded
              ? "Lead saved and activity logged. The workspace is refreshing."
              : "Lead and message saved, but the activity log could not be recorded. Contact an administrator."}
          </p>
        ) : null}
      </div>
    </section>
  );
}
