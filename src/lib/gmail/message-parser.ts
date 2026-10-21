export interface ParsedGmailMessage {
  id: string;
  threadId: string;
  sender: string | null;
  senderEmail: string | null;
  fromConnectedMailbox: boolean;
  subject: string | null;
  sentAt: string;
  body: string;
  autoSubmitted: string | null;
  precedence: string | null;
  listId: string | null;
  autoResponseSuppress: string | null;
}

interface GmailPayload {
  mimeType?: string | null;
  filename?: string | null;
  headers?: Array<{ name?: string | null; value?: string | null }>;
  body?: { data?: string | null };
  parts?: GmailPayload[];
}

export interface GmailApiMessage {
  id?: string | null;
  threadId?: string | null;
  internalDate?: string | null;
  snippet?: string | null;
  labelIds?: string[] | null;
  payload?: GmailPayload | null;
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    const normalized = code.toLowerCase();
    if (normalized.startsWith("#x")) {
      const point = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(point) && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : entity;
    }
    if (normalized.startsWith("#")) {
      const point = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(point) && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : entity;
    }
    return {
      amp: "&",
      lt: "<",
      gt: ">",
      quot: '"',
      apos: "'",
      nbsp: " ",
    }[normalized] ?? entity;
  });
}

function decodeMimeHeader(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
    (encoded, charset: string, encoding: string, data: string) => {
      try {
        const bytes =
          encoding.toLowerCase() === "b"
            ? Buffer.from(data, "base64")
            : Buffer.from(
                data.replaceAll("_", " ").replace(/=([0-9a-f]{2})/gi, (_, hex: string) =>
                  String.fromCharCode(Number.parseInt(hex, 16)),
                ),
                "binary",
              );
        return new TextDecoder(charset).decode(bytes);
      } catch {
        return encoded;
      }
    },
  );
}

function htmlToText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function collectBodies(payload: GmailPayload): {
  plain: string[];
  html: string[];
} {
  const result = { plain: [] as string[], html: [] as string[] };
  const visit = (part: GmailPayload) => {
    if (part.filename) return;
    const data = part.body?.data;
    if (data) {
      const decoded = decodeBase64Url(data);
      if (part.mimeType?.toLowerCase() === "text/plain") result.plain.push(decoded);
      if (part.mimeType?.toLowerCase() === "text/html") result.html.push(decoded);
    }
    part.parts?.forEach(visit);
  };
  visit(payload);
  return result;
}

function headerValue(
  payload: GmailPayload | null | undefined,
  name: string,
): string | null {
  const header = payload?.headers?.find(
    (item) => item.name?.toLowerCase() === name.toLowerCase(),
  );
  return header?.value ? decodeMimeHeader(header.value.trim()) : null;
}

export function parseGmailMessage(
  message: GmailApiMessage,
  mailboxEmail?: string,
): ParsedGmailMessage | null {
  if (!message.id || !message.threadId) return null;

  const from = headerValue(message.payload, "from");
  const senderEmail =
    from?.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1]?.toLowerCase() ??
    from?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ??
    null;
  const displayName = from
    ?.replace(/<[^<>]*>/g, "")
    .replace(/=\?[^?]+\?[bq]\?[^?]*\?=/gi, (encoded) =>
      decodeMimeHeader(encoded),
    )
    .replace(/^["']|["']$/g, "")
    .trim();
  const sender =
    displayName && !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(displayName)
      ? displayName
      : null;
  const bodies = message.payload ? collectBodies(message.payload) : { plain: [], html: [] };
  const body =
    bodies.plain.join("\n").trim() ||
    bodies.html.map(htmlToText).filter(Boolean).join("\n").trim() ||
    message.snippet?.trim() ||
    "";
  const milliseconds = Number(message.internalDate);
  const headerDate = headerValue(message.payload, "date");
  const parsedDate = Number.isFinite(milliseconds)
    ? new Date(milliseconds)
    : headerDate
      ? new Date(headerDate)
      : new Date();
  const sentAt = Number.isNaN(parsedDate.getTime())
    ? new Date().toISOString()
    : parsedDate.toISOString();

  return {
    id: message.id,
    threadId: message.threadId,
    sender,
    senderEmail,
    fromConnectedMailbox: Boolean(
      senderEmail &&
        mailboxEmail &&
        senderEmail.toLowerCase() === mailboxEmail.toLowerCase(),
    ),
    subject: headerValue(message.payload, "subject"),
    sentAt,
    body: body.slice(0, 6000),
    autoSubmitted: headerValue(message.payload, "auto-submitted"),
    precedence: headerValue(message.payload, "precedence"),
    listId: headerValue(message.payload, "list-id"),
    autoResponseSuppress: headerValue(
      message.payload,
      "x-auto-response-suppress",
    ),
  };
}
