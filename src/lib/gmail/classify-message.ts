import type { ParsedGmailMessage } from "@/lib/gmail/message-parser";

export type GmailIgnoredReason =
  | "sent_by_connected_mailbox"
  | "missing_sender_email"
  | "automated_header"
  | "automated_sender"
  | "job_alert"
  | "newsletter_or_notification";

export type GmailMessageClassification =
  | { type: "sales_inquiry" }
  | { type: "ignored"; reason: GmailIgnoredReason };

const automatedSenderPattern =
  /(?:^|[._+-])(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer[-_.]?daemon|notifications?|alerts?)(?:[._+-]|$)/i;
const jobAlertPattern =
  /\b(job alert|jobs? matching|new jobs? from|glassdoor|job application|application update|careers digest)\b/i;
const newsletterPattern =
  /\b(newsletter|weekly digest|daily digest|account security alert|new sign.?in|verify your account|google account alert|notification)\b/i;

export function classifyGmailMessage(
  message: ParsedGmailMessage,
): GmailMessageClassification {
  if (message.fromConnectedMailbox) {
    return { type: "ignored", reason: "sent_by_connected_mailbox" };
  }
  if (!message.senderEmail) {
    return { type: "ignored", reason: "missing_sender_email" };
  }
  if (
    (message.autoSubmitted &&
      message.autoSubmitted.toLowerCase() !== "no") ||
    /\b(bulk|list|junk)\b/i.test(message.precedence ?? "") ||
    Boolean(message.listId) ||
    Boolean(message.autoResponseSuppress)
  ) {
    return { type: "ignored", reason: "automated_header" };
  }

  const senderLocalPart = message.senderEmail.split("@")[0] ?? "";
  const senderDomain = message.senderEmail.split("@")[1] ?? "";
  const subject = message.subject ?? "";
  if (automatedSenderPattern.test(senderLocalPart)) {
    return { type: "ignored", reason: "automated_sender" };
  }
  if (
    /(^|\.)glassdoor\./i.test(senderDomain) ||
    jobAlertPattern.test(subject)
  ) {
    return { type: "ignored", reason: "job_alert" };
  }
  if (newsletterPattern.test(subject)) {
    return { type: "ignored", reason: "newsletter_or_notification" };
  }
  return { type: "sales_inquiry" };
}
