import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { encryptGmailTokens } from "@/lib/gmail/crypto";
import {
  exchangeGmailAuthorizationCode,
  GoogleOAuthError,
} from "@/lib/gmail/google-api";
import {
  getOAuthCallbackFailureMessage,
  type GmailOAuthCallbackStage,
} from "@/lib/gmail/callback-diagnostics";
import { createGmailRepository } from "@/lib/gmail/repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function isActiveRepresentative(userId: string): Promise<boolean> {
  const { data, error } = await createSupabaseAdminClient()
    .from("sales_representatives")
    .select("id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    console.error("[gmail] OAuth representative verification failed", {
      code: error.code ?? "unknown",
    });
    throw new Error("OAuth representative verification failed.");
  }
  return Boolean(data);
}

function redirect(request: Request, result: string) {
  const configuredRedirect = process.env.GMAIL_REDIRECT_URI;
  const origin = configuredRedirect
    ? new URL(configuredRedirect).origin
    : new URL(request.url).origin;
  const url = new URL("/", origin);
  url.searchParams.set("gmail", result);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const googleError = url.searchParams.get("error");
  if (!state) {
    console.error("[gmail] OAuth callback failed", {
      stage: "state_validation",
      code: "missing_state",
      message: "Gmail OAuth state was missing.",
    });
    return redirect(request, "error");
  }

  let callbackUserId: string | null = null;
  let repository: ReturnType<typeof createGmailRepository> | null = null;
  let stage: GmailOAuthCallbackStage = "callback_setup";
  try {
    repository = createGmailRepository(createSupabaseAdminClient());
    stage = "state_validation";
    const consumed = await repository.consumeOAuthState(
      createHash("sha256").update(state).digest("hex"),
    );
    if (!consumed) {
      console.error("[gmail] OAuth callback failed", {
        stage,
        code: "invalid_state",
        message:
          "Gmail OAuth state was missing, expired, or could not be consumed.",
      });
      return redirect(request, "error");
    }
    callbackUserId = consumed.userId;
    if (googleError || !code) {
      stage = "connection_status_persistence";
      await repository.saveConnectionStatus(
        consumed.userId,
        "error",
        "Google authorization was cancelled or denied. Try connecting again.",
      );
      console.error("[gmail] OAuth callback failed", {
        stage: "authorization_response",
        code: "authorization_denied",
        message:
          "Google authorization was cancelled, denied, or returned no authorization code.",
      });
      return redirect(request, "error");
    }
    stage = "representative_authorization";
    if (!(await isActiveRepresentative(consumed.userId))) {
      stage = "connection_status_persistence";
      await repository.saveConnectionStatus(
        consumed.userId,
        "error",
        "This account no longer has active representative access.",
      );
      console.error("[gmail] OAuth callback failed", {
        stage: "representative_authorization",
        code: "inactive_representative",
        message:
          "The OAuth account could not be verified as an active representative.",
      });
      return redirect(request, "error");
    }

    stage = "token_exchange";
    const tokens = await exchangeGmailAuthorizationCode(code);
    stage = "token_encryption";
    const encryptedTokens = encryptGmailTokens(tokens);
    stage = "credential_persistence";
    await repository.saveCredentials(encryptedTokens, consumed.userId);
    stage = "connection_status_persistence";
    await repository.saveConnectionStatus(consumed.userId, "connected");
    return redirect(request, "connected");
  } catch (error) {
    console.error("[gmail] OAuth callback failed", {
      stage,
      code: error instanceof GoogleOAuthError ? error.code : "oauth_callback",
      message: getOAuthCallbackFailureMessage(
        stage,
        error,
        error instanceof GoogleOAuthError,
      ),
    });
    if (callbackUserId && repository) {
      try {
        await repository.saveConnectionStatus(
          callbackUserId,
          "error",
          "Google could not complete the mailbox connection. Check the OAuth setup and try again.",
        );
      } catch {
        console.error("[gmail] OAuth callback error could not be recorded");
      }
    }
    return redirect(request, "error");
  }
}
