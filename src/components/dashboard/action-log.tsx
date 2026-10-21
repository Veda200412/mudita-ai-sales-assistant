import { ClipboardList } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { SectionCard } from "@/components/ui/section-card";
import type { ActionLogEntry } from "@/lib/types/lead";

interface ActionLogProps {
  entries: ActionLogEntry[];
}

export function ActionLog({ entries }: ActionLogProps) {
  return (
    <SectionCard
      title="Action log"
      description="A record of assistant and team activity."
      className="action-log-panel"
    >
      {entries.length > 0 ? (
        <ol className="action-list">
          {entries.map((entry) => (
            <li className="action-item" key={entry.id}>
              <span className="action-marker" />
              <div>
                <p>{entry.summary}</p>
                <span>{entry.actionType} · {formatRelativeTime(entry.createdAt)}</span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="activity-empty">
          <span className="empty-icon"><ClipboardList aria-hidden="true" size={19} /></span>
          <p>No activity to show yet.</p>
          <span>Actions will be recorded here as your workspace is connected.</span>
        </div>
      )}
    </SectionCard>
  );
}
