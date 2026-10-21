export type LeadStatus =
  | "new"
  | "qualifying"
  | "qualified"
  | "follow_up"
  | "meeting_booked"
  | "disqualified";

export type LeadChannel = "instagram" | "whatsapp" | "email";

export type MessageDirection = "inbound" | "outbound";

export type MeetingStatus =
  | "pending_confirmation"
  | "confirmed"
  | "cancelled";

export type LeadQualificationEvidence = Record<string, unknown>;

export interface SalesRepresentative {
  id: string;
  displayName: string;
  email: string;
  isActive: boolean;
}

export interface Lead {
  id: string;
  fullName: string | null;
  email: string | null;
  company: string | null;
  channel: LeadChannel;
  status: LeadStatus;
  assignedRepresentative: SalesRepresentative | null;
  qualificationEvidence: LeadQualificationEvidence;
  lastActivityAt: string | null;
  createdAt: string;
}

export interface Message {
  id: string;
  leadId: string;
  direction: MessageDirection;
  body: string;
  sentAt: string;
}

export interface Meeting {
  id: string;
  leadId: string;
  representativeId: string | null;
  status: MeetingStatus;
  startsAt: string;
  endsAt: string;
  confirmedAt: string | null;
}

export interface ActionLogEntry {
  id: string;
  leadId: string | null;
  actionType: string;
  summary: string;
  createdAt: string;
}

export interface DashboardStats {
  totalLeads: number;
  qualifiedLeads: number;
  pendingFollowUps: number;
  bookedMeetings: number;
}
