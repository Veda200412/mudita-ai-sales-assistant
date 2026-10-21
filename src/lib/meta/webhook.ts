import { createHmac, timingSafeEqual } from "node:crypto";
import type { LeadChannel } from "@/lib/types/lead";

export interface MetaInboundMessage {
  channel: "instagram" | "whatsapp";
  id: string;
  threadId: string;
  senderId: string;
  senderName: string | null;
  sentAt: string;
  body: string;
  hasText: boolean;
}

export class MetaWebhookError extends Error {
  constructor(
    public readonly code:
      | "configuration"
      | "signature"
      | "verification"
      | "payload",
    message: string,
  ) {
    super(message);
    this.name = "MetaWebhookError";
  }
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readTimestamp(value: unknown): string {
  const milliseconds =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof value === "string" && /^\d{10,13}$/.test(value)
        ? Number(value) * (value.length === 10 ? 1000 : 1)
        : Number.NaN;
  if (Number.isFinite(milliseconds) && milliseconds >= 0 && milliseconds <= 8.64e15) {
    return new Date(milliseconds).toISOString();
  }
  throw new MetaWebhookError("payload", "Webhook message timestamp is invalid.");
}

function textOrPlaceholder(
  value: unknown,
  channel: LeadChannel,
  messageType?: string,
): string {
  const text = readString(value);
  if (text) return text.slice(0, 6000);
  const kind = messageType?.replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "non-text";
  return `Incoming ${channel} ${kind} message; media content is not available for qualification.`;
}

function instagramEvents(payload: UnknownRecord): MetaInboundMessage[] {
  if (!Array.isArray(payload.entry)) {
    throw new MetaWebhookError("payload", "Instagram webhook entry is missing.");
  }
  const messages: MetaInboundMessage[] = [];
  for (const entry of payload.entry) {
    if (!isRecord(entry)) throw new MetaWebhookError("payload", "Instagram entry is invalid.");
    if (entry.messaging === undefined) continue;
    if (!Array.isArray(entry.messaging)) {
      throw new MetaWebhookError("payload", "Instagram messaging events are invalid.");
    }
    for (const event of entry.messaging) {
      if (!isRecord(event)) continue;
      if (event.message === undefined) continue;
      if (!isRecord(event.message)) {
        throw new MetaWebhookError("payload", "Instagram message is invalid.");
      }
      if (event.message.is_echo === true) continue;
      const sender = isRecord(event.sender) ? readString(event.sender.id) : null;
      const recipient = isRecord(event.recipient)
        ? readString(event.recipient.id)
        : null;
      const messageId = readString(event.message.mid);
      if (!sender || !recipient || !messageId) {
        throw new MetaWebhookError("payload", "Instagram message identifiers are incomplete.");
      }
      const text = readString(event.message.text);
      const body = textOrPlaceholder(
        text,
        "instagram",
        Array.isArray(event.message.attachments) ? "attachment" : "non-text",
      );
      messages.push({
        channel: "instagram",
        id: messageId,
        threadId: `${recipient}:${sender}`,
        senderId: sender,
        senderName: null,
        sentAt: readTimestamp(event.timestamp),
        body,
        hasText: text !== null,
      });
    }
  }
  return messages;
}

function whatsappEvents(payload: UnknownRecord): MetaInboundMessage[] {
  if (!Array.isArray(payload.entry)) {
    throw new MetaWebhookError("payload", "WhatsApp webhook entry is missing.");
  }
  const messages: MetaInboundMessage[] = [];
  for (const entry of payload.entry) {
    if (!isRecord(entry)) throw new MetaWebhookError("payload", "WhatsApp entry is invalid.");
    if (!Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!isRecord(change) || !isRecord(change.value)) continue;
      const value = change.value;
      if (!Array.isArray(value.messages)) continue;
      const phoneNumberId = isRecord(value.metadata)
        ? readString(value.metadata.phone_number_id)
        : null;
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      for (const rawMessage of value.messages) {
        if (!isRecord(rawMessage)) {
          throw new MetaWebhookError("payload", "WhatsApp message is invalid.");
        }
        const sender = readString(rawMessage.from);
        const messageId = readString(rawMessage.id);
        if (!sender || !messageId || !phoneNumberId) {
          throw new MetaWebhookError("payload", "WhatsApp message identifiers are incomplete.");
        }
        const contact = contacts.find((item) =>
          isRecord(item) &&
          (readString(item.wa_id) === sender ||
            readString(item.input) === sender),
        );
        const profileName =
          isRecord(contact) && isRecord(contact.profile)
            ? readString(contact.profile.name)
            : null;
        const type = readString(rawMessage.type) ?? "non-text";
        const interactive = isRecord(rawMessage.interactive)
          ? rawMessage.interactive
          : null;
        const interactiveText =
          interactive && isRecord(interactive.button_reply)
            ? readString(interactive.button_reply.title)
            : interactive && isRecord(interactive.list_reply)
              ? readString(interactive.list_reply.title)
              : null;
        const text = isRecord(rawMessage.text)
          ? readString(rawMessage.text.body)
          : interactiveText;
        const body = textOrPlaceholder(
          text,
          "whatsapp",
          type,
        );
        messages.push({
          channel: "whatsapp",
          id: messageId,
          threadId: `${phoneNumberId}:${sender}`,
          senderId: sender,
          senderName: profileName,
          sentAt: readTimestamp(rawMessage.timestamp),
          body,
          hasText: text !== null,
        });
      }
    }
  }
  return messages;
}

export function parseMetaWebhookPayload(
  payload: unknown,
  channel: "instagram" | "whatsapp",
): MetaInboundMessage[] {
  if (!isRecord(payload)) {
    throw new MetaWebhookError("payload", "Webhook body must be a JSON object.");
  }
  const expectedObject =
    channel === "instagram" ? "instagram" : "whatsapp_business_account";
  if (payload.object !== expectedObject) {
    throw new MetaWebhookError("payload", "Webhook channel does not match this event.");
  }
  return channel === "instagram"
    ? instagramEvents(payload)
    : whatsappEvents(payload);
}

export function verifyMetaSignature(
  rawBody: string | Uint8Array,
  signatureHeader: string | null,
  appSecret: string | undefined,
): boolean {
  return verifyMetaSignatureWithReason(rawBody, signatureHeader, appSecret).valid;
}

export function verifyMetaSignatureWithReason(
  rawBody: string | Uint8Array,
  signatureHeader: string | null,
  appSecret: string | undefined,
): { valid: true } | {
  valid: false;
  reason: "missing_header" | "malformed_header" | "signature_mismatch";
} {
  if (!appSecret?.trim()) {
    throw new MetaWebhookError(
      "configuration",
      "Set META_APP_SECRET to enable Meta webhook signature verification.",
    );
  }
  if (!signatureHeader) return { valid: false, reason: "missing_header" };
  if (!/^sha256=[a-f0-9]{64}$/i.test(signatureHeader)) {
    return { valid: false, reason: "malformed_header" };
  }
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const provided = Buffer.from(signatureHeader.slice(7), "hex");
  return provided.length === expected.length && timingSafeEqual(provided, expected)
    ? { valid: true }
    : { valid: false, reason: "signature_mismatch" };
}

export function verifyMetaSignatureForChannels(
  rawBody: string | Uint8Array,
  signatureHeader: string | null,
  secrets: {
    instagram: string | undefined;
    whatsapp: string | undefined;
  },
): { valid: true; matchedChannels: Array<"instagram" | "whatsapp"> } | {
  valid: false;
  reason: "missing_header" | "malformed_header" | "signature_mismatch";
} {
  const configuredSecrets = (
    Object.entries(secrets) as Array<["instagram" | "whatsapp", string | undefined]>
  ).filter((entry): entry is ["instagram" | "whatsapp", string] => Boolean(entry[1]?.trim()));
  if (configuredSecrets.length === 0) {
    throw new MetaWebhookError(
      "configuration",
      "Set META_APP_SECRET or a channel-specific Meta app secret to enable signature verification.",
    );
  }
  if (!signatureHeader) return { valid: false, reason: "missing_header" };
  if (!/^sha256=[a-f0-9]{64}$/i.test(signatureHeader)) {
    return { valid: false, reason: "malformed_header" };
  }

  const provided = Buffer.from(signatureHeader.slice(7), "hex");
  const matchedChannels: Array<"instagram" | "whatsapp"> = [];
  for (const [source, secret] of configuredSecrets) {
    const expected = createHmac("sha256", secret).update(rawBody).digest();
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      matchedChannels.push(source);
    }
  }
  return matchedChannels.length > 0
    ? { valid: true, matchedChannels }
    : { valid: false, reason: "signature_mismatch" };
}

export function verifyMetaChallenge(input: {
  mode: string | null;
  token: string | null;
  challenge: string | null;
  configuredToken: string | undefined;
}): string {
  if (!input.configuredToken?.trim()) {
    throw new MetaWebhookError(
      "configuration",
      "Set META_VERIFY_TOKEN to enable Meta webhook verification.",
    );
  }
  if (
    input.mode !== "subscribe" ||
    input.token !== input.configuredToken ||
    !input.challenge
  ) {
    throw new MetaWebhookError("verification", "Meta webhook verification failed.");
  }
  return input.challenge;
}
