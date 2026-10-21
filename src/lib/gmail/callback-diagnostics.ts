export type GmailOAuthCallbackStage =
  | "callback_setup"
  | "state_validation"
  | "authorization_response"
  | "representative_authorization"
  | "token_exchange"
  | "token_encryption"
  | "credential_persistence"
  | "connection_status_persistence";

const stageMessages: Record<GmailOAuthCallbackStage, string> = {
  callback_setup:
    "Gmail OAuth callback setup failed. Check Supabase server configuration, including SUPABASE_SERVICE_ROLE_KEY.",
  state_validation: "Gmail OAuth state was missing, expired, or could not be consumed.",
  authorization_response:
    "Google authorization was cancelled, denied, or returned no authorization code.",
  representative_authorization:
    "The OAuth account could not be verified as an active representative.",
  token_exchange:
    "Google token exchange failed. Verify GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REDIRECT_URI, and the Google Cloud redirect URI.",
  token_encryption:
    "Gmail token encryption failed. GMAIL_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes.",
  credential_persistence:
    "Encrypted Gmail credentials could not be saved to Supabase action_logs. Check SUPABASE_SERVICE_ROLE_KEY and database availability.",
  connection_status_persistence:
    "OAuth credentials may have been saved, but the Gmail connection status could not be recorded in Supabase action_logs.",
};

export function sanitizeOAuthErrorMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted URL]")
    .replace(
      /(authorization[_ -]?code|oauth[_ -]?code|code|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|encryption[_ -]?key|GMAIL_TOKEN_ENCRYPTION_KEY)\s*[:=]\s*["']?[^,\s"']+/gi,
      "$1=[redacted]",
    )
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b[A-Za-z0-9_./+=-]{24,}\b/g, "[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 240);
}

export function getOAuthCallbackFailureMessage(
  stage: GmailOAuthCallbackStage,
  error: unknown,
  isGoogleOAuthError: boolean,
): string {
  if (isGoogleOAuthError && error instanceof Error) {
    return sanitizeOAuthErrorMessage(error.message);
  }
  return stageMessages[stage];
}
