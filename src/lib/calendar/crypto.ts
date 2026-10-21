import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { CalendarTokens } from "@/lib/calendar/google-api";

function encryptionKey(): Buffer {
  const encoded = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY is not configured.");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32) {
    throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  return key;
}

export function encryptCalendarTokens(tokens: CalendarTokens) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from("mudita-calendar-oauth-v1"));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(tokens), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

export function decryptCalendarTokens(value: unknown): CalendarTokens {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("iv" in value) ||
    typeof value.iv !== "string" ||
    !("tag" in value) ||
    typeof value.tag !== "string" ||
    !("ciphertext" in value) ||
    typeof value.ciphertext !== "string"
  ) {
    throw new Error("Stored Calendar credentials are invalid.");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(value.iv, "base64url"),
    );
    decipher.setAAD(Buffer.from("mudita-calendar-oauth-v1"));
    decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
    const parsed: unknown = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(value.ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8"),
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("accessToken" in parsed) ||
      typeof parsed.accessToken !== "string" ||
      !("refreshToken" in parsed) ||
      typeof parsed.refreshToken !== "string" ||
      !("expiresAt" in parsed) ||
      typeof parsed.expiresAt !== "number"
    ) {
      throw new Error("Invalid credentials");
    }
    return parsed as CalendarTokens;
  } catch {
    throw new Error(
      "Stored Calendar credentials could not be decrypted. Check GMAIL_TOKEN_ENCRYPTION_KEY.",
    );
  }
}
