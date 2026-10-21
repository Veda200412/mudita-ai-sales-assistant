import { MessageSquareText } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import type { Lead, Message } from "@/lib/types/lead";

export function ConversationPanel({
  lead,
  messages,
}: {
  lead: Lead | null;
  messages: Message[];
}) {
  const conversation = lead
    ? messages
        .filter((message) => message.leadId === lead.id)
        .sort((left, right) => left.sentAt.localeCompare(right.sentAt))
    : [];

  return (
    <SectionCard
      title="Conversation"
      description="A chronological view of lead messages."
      className="conversation-panel"
    >
      {conversation.length > 0 ? (
        <ol className="conversation-messages" id="conversation">
          {conversation.map((message) => (
            <li
              className={`conversation-message ${message.direction}`}
              key={message.id}
            >
              <p>{message.body}</p>
              <time dateTime={message.sentAt}>
                {new Date(message.sentAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <div className="conversation-empty" id="conversation">
          <span className="empty-icon"><MessageSquareText aria-hidden="true" size={20} /></span>
          <p className="empty-title">
            {lead ? "No messages recorded" : "No conversation selected"}
          </p>
          <p className="empty-description">
            {lead
              ? "Messages for this lead will appear here."
              : "Select a lead to review their conversation history."}
          </p>
        </div>
      )}
    </SectionCard>
  );
}
