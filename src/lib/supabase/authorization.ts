import "server-only";

import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";

export class AuthorizationError extends Error {
  constructor(
    public readonly status: 401 | 403 | 503,
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export async function authorizeActiveRepresentative(
  request: Request,
): Promise<{ userId: string }> {
  const authorization = request.headers.get("authorization");
  const tokenMatch = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  if (!tokenMatch) {
    throw new AuthorizationError(
      401,
      "Sign in with an authorized sales representative account.",
    );
  }

  let authClient;
  try {
    authClient = createSupabaseServerClient();
  } catch {
    throw new AuthorizationError(
      503,
      "Supabase authentication is not configured.",
    );
  }

  const { data: authData, error: authError } =
    await authClient.auth.getUser(tokenMatch[1]);
  if (authError || !authData.user) {
    throw new AuthorizationError(401, "Your session is invalid or expired.");
  }

  let adminClient;
  try {
    adminClient = createSupabaseAdminClient();
  } catch {
    throw new AuthorizationError(
      503,
      "Secure server-side data access is not configured.",
    );
  }

  const { data: representative, error: representativeError } =
    await adminClient
      .from("sales_representatives")
      .select("id")
      .eq("user_id", authData.user.id)
      .eq("is_active", true)
      .maybeSingle();

  if (representativeError) {
    console.error("[authorization] Representative lookup failed", {
      code: representativeError.code ?? "unknown",
    });
    throw new AuthorizationError(
      503,
      "Your workspace access could not be verified.",
    );
  }
  if (!representative) {
    throw new AuthorizationError(
      403,
      "This account is not linked to an active sales representative.",
    );
  }

  return { userId: authData.user.id };
}
