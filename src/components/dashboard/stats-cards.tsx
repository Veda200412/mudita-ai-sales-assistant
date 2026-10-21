import {
  CalendarCheck2,
  CircleCheck,
  ContactRound,
  MessageCircleMore,
} from "lucide-react";
import type { DashboardStats } from "@/lib/types/lead";

const cardDefinitions = [
  {
    label: "Total leads",
    key: "totalLeads",
    description: "Across all channels",
    icon: ContactRound,
    color: "blue",
  },
  {
    label: "Qualified leads",
    key: "qualifiedLeads",
    description: "Ready for a conversation",
    icon: CircleCheck,
    color: "green",
  },
  {
    label: "Pending follow-ups",
    key: "pendingFollowUps",
    description: "Need a next step",
    icon: MessageCircleMore,
    color: "amber",
  },
  {
    label: "Booked meetings",
    key: "bookedMeetings",
    description: "Confirmed with prospects",
    icon: CalendarCheck2,
    color: "violet",
  },
] as const;

export function StatsCards({ stats }: { stats: DashboardStats }) {
  return (
    <section className="stats-grid" aria-label="Lead overview metrics">
      {cardDefinitions.map(({ label, key, description, icon: Icon, color }) => (
        <article className="stat-card" key={key}>
          <div className="stat-top">
            <span className={`stat-icon ${color}`}><Icon aria-hidden="true" size={18} /></span>
            <span className="stat-period">Workspace</span>
          </div>
          <p className="stat-label">{label}</p>
          <p className="stat-value">{stats[key]}</p>
          <p className="stat-description">{description}</p>
        </article>
      ))}
    </section>
  );
}
