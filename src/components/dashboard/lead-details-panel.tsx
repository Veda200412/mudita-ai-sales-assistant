import { BadgeCheck, Building2, ClipboardList, UserRound } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { formatStatusLabel } from "@/lib/utils";
import type { Lead } from "@/lib/types/lead";

export function LeadDetailsPanel({ lead }: { lead: Lead | null }) {
  const evidence = lead?.qualificationEvidence;
  const detailEntries =
    evidence && typeof evidence === "object" && "evidence" in evidence
      ? evidence.evidence
      : null;
  const verifiedEvidence =
    detailEntries && typeof detailEntries === "object"
      ? Object.entries(detailEntries).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        )
      : [];

  return (
    <SectionCard title="Lead details" description="Qualification and ownership.">
      {lead ? (
        <>
          <div className="details-divider" />
          <div className="detail-placeholder-grid">
            <span><Building2 aria-hidden="true" size={15} /> Company</span>
            <span>{lead.company ?? "—"}</span>
            <span><BadgeCheck aria-hidden="true" size={15} /> Qualification</span>
            <span>{formatStatusLabel(lead.status)}</span>
            <span><UserRound aria-hidden="true" size={15} /> Assigned to</span>
            <span>{lead.assignedRepresentative?.displayName ?? "Unassigned"}</span>
          </div>
          <div className="evidence-heading">
            <span><ClipboardList aria-hidden="true" size={15} /> Qualification evidence</span>
            <span className="evidence-count">{verifiedEvidence.length}</span>
          </div>
          {verifiedEvidence.length > 0 ? (
            <ul className="lead-evidence-list">
              {verifiedEvidence.map(([field, quote]) => (
                <li key={field}>
                  <span>{field.replaceAll(/([A-Z])/g, " $1")}</span>
                  <q>{quote}</q>
                </li>
              ))}
            </ul>
          ) : (
            <p className="evidence-empty">No verified evidence recorded.</p>
          )}
        </>
      ) : (
        <div className="details-empty">
          <span className="empty-icon"><UserRound aria-hidden="true" size={19} /></span>
          <p>Select a lead to see their details.</p>
        </div>
      )}
    </SectionCard>
  );
}
