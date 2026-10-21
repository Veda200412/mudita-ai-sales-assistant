export const GEMINI_MODEL = "gemini-3.5-flash-lite";

const serverEnvironmentVariables = {
  supabaseUrl: "NEXT_PUBLIC_SUPABASE_URL",
  supabaseAnonKey: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  supabaseServiceRoleKey: "SUPABASE_SERVICE_ROLE_KEY",
  geminiApiKey: "GEMINI_API_KEY",
  googleClientId: "GOOGLE_CLIENT_ID",
  googleClientSecret: "GOOGLE_CLIENT_SECRET",
  googleRedirectUri: "GOOGLE_REDIRECT_URI",
  googleCalendarId: "GOOGLE_CALENDAR_ID",
  metaAppId: "META_APP_ID",
  metaAppSecret: "META_APP_SECRET",
  metaVerifyToken: "META_VERIFY_TOKEN",
  metaAccessToken: "META_ACCESS_TOKEN",
  gmailClientId: "GMAIL_CLIENT_ID",
  gmailClientSecret: "GMAIL_CLIENT_SECRET",
  gmailRedirectUri: "GMAIL_REDIRECT_URI",
  gmailTokenEncryptionKey: "GMAIL_TOKEN_ENCRYPTION_KEY",
} as const;

export type ServerEnvironmentKey = keyof typeof serverEnvironmentVariables;

export class SupabaseConfigurationError extends Error {}

export function getMissingEnvironmentVariables(
  keys: readonly ServerEnvironmentKey[],
): string[] {
  return keys
    .map((key) => serverEnvironmentVariables[key])
    .filter((name) => !process.env[name]?.trim());
}

export function requireServerEnvironment(
  keys: readonly ServerEnvironmentKey[],
): void {
  const missing = getMissingEnvironmentVariables(keys);
  if (missing.length > 0) {
    throw new Error(
      `Server configuration is incomplete. Set the following environment variables: ${missing.join(", ")}.`,
    );
  }
}

export function getSupabasePublicConfig(): {
  url: string;
  anonKey: string;
} {
  requireServerEnvironment(["supabaseUrl", "supabaseAnonKey"]);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new SupabaseConfigurationError(
      "Supabase public configuration is incomplete.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new SupabaseConfigurationError(
      "NEXT_PUBLIC_SUPABASE_URL must be a valid HTTP or HTTPS URL.",
    );
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new SupabaseConfigurationError(
      "NEXT_PUBLIC_SUPABASE_URL must be a valid HTTP or HTTPS URL.",
    );
  }

  if (
    parsedUrl.pathname !== "/" ||
    parsedUrl.search.length > 0 ||
    parsedUrl.hash.length > 0
  ) {
    throw new SupabaseConfigurationError(
      "NEXT_PUBLIC_SUPABASE_URL must be the project root URL without a REST path, query, or fragment.",
    );
  }

  return {
    url,
    anonKey,
  };
}
