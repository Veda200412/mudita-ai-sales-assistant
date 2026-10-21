"use client";

import { useMemo, useState } from "react";
import { Search, SlidersHorizontal, UsersRound } from "lucide-react";
import { formatRelativeTime, formatStatusLabel } from "@/lib/utils";
import type { Lead, LeadStatus } from "@/lib/types/lead";

const statuses: LeadStatus[] = [
  "new",
  "qualifying",
  "qualified",
  "follow_up",
  "meeting_booked",
  "disqualified",
];

interface LeadsTableProps {
  leads: Lead[];
  selectedLeadId: string | null;
  onSelectLead: (leadId: string) => void;
}

export function LeadsTable({
  leads,
  selectedLeadId,
  onSelectLead,
}: LeadsTableProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "all">("all");
  const filteredLeads = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return leads.filter((lead) => {
      const matchesStatus = statusFilter === "all" || lead.status === statusFilter;
      const matchesSearch =
        normalizedQuery.length === 0 ||
        [lead.fullName, lead.email, lead.company]
          .some((value) => value?.toLowerCase().includes(normalizedQuery));
      return matchesStatus && matchesSearch;
    });
  }, [leads, query, statusFilter]);

  return (
    <div className="table-card">
      <div className="table-toolbar">
        <label className="search-field">
          <Search aria-hidden="true" size={17} />
          <span className="sr-only">Search leads</span>
          <input
            type="search"
            placeholder="Search leads..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>⌘ K</kbd>
        </label>
        <label className="filter-select">
          <SlidersHorizontal aria-hidden="true" size={16} />
          <span className="sr-only">Filter leads by status</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as LeadStatus | "all")}
          >
            <option value="all">All statuses</option>
            {statuses.map((status) => (
              <option value={status} key={status}>{formatStatusLabel(status)}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Lead</th>
              <th scope="col">Channel</th>
              <th scope="col">Status</th>
              <th scope="col">Assigned to</th>
              <th scope="col">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {filteredLeads.map((lead) => (
              <tr
                key={lead.id}
                className={selectedLeadId === lead.id ? "selected-lead-row" : undefined}
              >
                <td>
                  <button
                    className="lead-select"
                    type="button"
                    onClick={() => onSelectLead(lead.id)}
                    aria-label={`View ${lead.fullName ?? "unnamed lead"}`}
                  >
                  <div className="lead-person">
                    <span className="lead-avatar">{lead.fullName?.slice(0, 1) ?? "?"}</span>
                    <span className="lead-person-copy">
                      <span className="lead-name">{lead.fullName ?? "Unnamed lead"}</span>
                      <span className="lead-company">{lead.company ?? lead.email ?? "—"}</span>
                    </span>
                  </div>
                  </button>
                </td>
                <td><span className={`channel-tag ${lead.channel}`}>{lead.channel}</span></td>
                <td><span className={`status-badge ${lead.status}`}>{formatStatusLabel(lead.status)}</span></td>
                <td>{lead.assignedRepresentative?.displayName ?? "Unassigned"}</td>
                <td>{formatRelativeTime(lead.lastActivityAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredLeads.length === 0 ? (
          <div className="table-empty-state">
            <span className="empty-icon"><UsersRound aria-hidden="true" size={20} /></span>
            <h3>{query || statusFilter !== "all" ? "No matching leads" : "Your leads will show up here"}</h3>
            <p>
              {query || statusFilter !== "all"
                ? "Try changing your search or status filter."
                : "No persisted customer inquiries are available yet."}
            </p>
          </div>
        ) : null}
      </div>
      <div className="table-footer">
        <span>
          {leads.length > 0
            ? `Showing ${filteredLeads.length} of ${leads.length} leads`
            : "No persisted lead records"}
        </span>
        <span>{leads.length > 0 ? "Live workspace data" : "Supabase workspace"}</span>
      </div>
    </div>
  );
}
