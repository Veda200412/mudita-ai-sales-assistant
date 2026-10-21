import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  AuthorizationError,
  authorizeActiveRepresentative,
} from "@/lib/supabase/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { createGmailRepository } from "@/lib/gmail/repository";
import { createGmailAuthorizationUrl } from "@/lib/gmail/google-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { userId } = await authorizeActiveRepresentative(request);
    const state = randomBytes(32).toString("base64url");
    const repository = createGmailRepository(createSupabaseAdminClient());
    await repository.saveOAuthState({
      stateHash: createHash("sha256").update(state).digest("hex"),
      userId,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    return NextResponse.json({
      authorizationUrl: createGmailAuthorizationUrl(state),
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[gmail] OAuth connection could not be started");
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message.includes("GMAIL_")
            ? error.message
            : "Gmail connection could not be started. Check the server configuration and try again.",
      },
      { status: 503 },
    );
  }
}
