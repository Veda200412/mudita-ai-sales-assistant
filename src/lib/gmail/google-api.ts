import "server-only";

import type { GmailApiMessage } from "@/lib/gmail/message-parser";

const gmailScope = "https://www.googleapis.com/auth/gmail.readonly";

export class GoogleOAuthError extends Error {
  constructor(
    public readonly code:
      | "invalid_grant"
      | "oauth_failure"
      | "gmail_api_failure"
      | "rate_limited",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

function oauthConfiguration() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Configure GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REDIRECT_URI.",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export function createGmailAuthorizationUrl(state: string): string {
  const { clientId, redirectUri } = oauthConfiguration();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: gmailScope,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
  }).toString();
  return url.toString();
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
}

async function requestToken(
  values: Record<string, string>,
): Promise<TokenResponse> {
  const { clientId, clientSecret } = oauthConfiguration();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      ...values,
    }),
    cache: "no-store",
  });
  let result: TokenResponse;
  try {
    result = (await response.json()) as TokenResponse;
  } catch {
    throw new GoogleOAuthError(
      "oauth_failure",
      "Google returned an unreadable OAuth response.",
      response.status,
    );
  }
  if (!response.ok) {
    const code = result.error === "invalid_grant" ? "invalid_grant" : "oauth_failure";
    throw new GoogleOAuthError(
      code,
      code === "invalid_grant"
        ? "Google authorization was revoked or expired. Reconnect the mailbox."
        : "Google OAuth failed. Check the Google Cloud OAuth configuration and try again.",
      response.status,
    );
  }
  return result;
}

function tokenFields(result: TokenResponse) {
  if (
    typeof result.access_token !== "string" ||
    typeof result.expires_in !== "number"
  ) {
    throw new GoogleOAuthError(
      "oauth_failure",
      "Google OAuth did not return usable access credentials.",
    );
  }
  return {
    accessToken: result.access_token,
    expiresAt: Date.now() + result.expires_in * 1000,
  };
}

export async function exchangeGmailAuthorizationCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}> {
  const { redirectUri } = oauthConfiguration();
  const response = await requestToken({
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  if (
    typeof response.refresh_token !== "string" ||
    typeof response.scope !== "string" ||
    !response.scope.split(/\s+/).includes(gmailScope)
  ) {
    throw new GoogleOAuthError(
      "oauth_failure",
      "Google did not grant the required Gmail read-only access. Reconnect and approve the Gmail read-only permission.",
    );
  }
  return {
    ...tokenFields(response),
    refreshToken: response.refresh_token,
  };
}

export async function refreshGmailAccessToken(refreshToken: string) {
  const response = await requestToken({
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  return {
    ...tokenFields(response),
    refreshToken,
  };
}

async function gmailRequest<T>(
  accessToken: string,
  url: string,
): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const code = response.status === 429
      ? "rate_limited"
      : "gmail_api_failure";
    throw new GoogleOAuthError(
      code,
      response.status === 429
        ? "Gmail is rate-limiting requests. Wait briefly and sync again."
        : response.status === 401
          ? "Gmail rejected the access credentials. Reconnect the mailbox."
          : `Gmail API request failed (HTTP ${response.status}). Try again later.`,
      response.status,
    );
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new GoogleOAuthError(
      "gmail_api_failure",
      "Gmail returned an unreadable API response. Try syncing again.",
      response.status,
    );
  }
}

export async function listRecentGmailMessages(accessToken: string): Promise<
  Array<{ id: string; threadId: string }>
> {
  const params = new URLSearchParams({
    maxResults: "50",
    q: "in:inbox newer_than:30d",
  });
  const result = await gmailRequest<{
    messages?: Array<{ id?: string; threadId?: string }>;
  }>(
    accessToken,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
  );
  return (result.messages ?? []).flatMap((message) =>
    message.id && message.threadId
      ? [{ id: message.id, threadId: message.threadId }]
      : [],
  );
}

export async function getGmailMailboxEmail(
  accessToken: string,
): Promise<string> {
  const profile = await gmailRequest<{ emailAddress?: string }>(
    accessToken,
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
  );
  if (!profile.emailAddress?.includes("@")) {
    throw new GoogleOAuthError(
      "gmail_api_failure",
      "Gmail did not return a usable mailbox identity.",
    );
  }
  return profile.emailAddress.toLowerCase();
}

export async function getGmailMessage(
  accessToken: string,
  id: string,
): Promise<GmailApiMessage> {
  return gmailRequest<GmailApiMessage>(
    accessToken,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
  );
}
