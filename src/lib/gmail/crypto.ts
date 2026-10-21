import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface GmailTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface EncryptedValue {
  [key: string]: string | number;
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

function encryptionKey(): Buffer {
  const encoded = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!encoded) {
    throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY is not configured.");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32) {
    throw new Error(
      "GMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.",
    );
  }
  return key;
}

export function encryptGmailTokens(tokens: GmailTokens): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from("mudita-gmail-oauth-v1"));
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

export function decryptGmailTokens(value: unknown): GmailTokens {
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
    throw new Error("Stored Gmail credentials are invalid.");
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(value.iv, "base64url"),
    );
    decipher.setAAD(Buffer.from("mudita-gmail-oauth-v1"));
    decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const tokens: unknown = JSON.parse(plaintext);
    if (
      typeof tokens !== "object" ||
      tokens === null ||
      !("accessToken" in tokens) ||
      typeof tokens.accessToken !== "string" ||
      !("refreshToken" in tokens) ||
      typeof tokens.refreshToken !== "string" ||
      !("expiresAt" in tokens) ||
      typeof tokens.expiresAt !== "number"
    ) {
      throw new Error("Stored Gmail credentials are invalid.");
    }
    return tokens as GmailTokens;
  } catch {
    throw new Error(
      "Stored Gmail credentials could not be decrypted. Check GMAIL_TOKEN_ENCRYPTION_KEY.",
    );
  }
}
