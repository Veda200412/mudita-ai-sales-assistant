import { NextResponse } from "next/server";
import {
  AuthorizationError,
  authorizeActiveRepresentative,
} from "@/lib/supabase/authorization";
import { getMissingEnvironmentVariables } from "@/lib/config";
import { createGmailRepository } from "@/lib/gmail/repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await authorizeActiveRepresentative(request);
    const missing = getMissingEnvironmentVariables([
      "gmailClientId",
      "gmailClientSecret",
      "gmailRedirectUri",
      "gmailTokenEncryptionKey",
    ]);
    if (missing.length > 0) {
      return NextResponse.json({
        configured: false,
        connected: false,
        lastSuccessfulSync: null,
        error: `Complete server setup for ${missing.join(", ")}.`,
      });
    }
    const status = await createGmailRepository(
      createSupabaseAdminClient(),
    ).getStatus();
    return NextResponse.json({ configured: true, ...status });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[gmail] Integration status could not be loaded");
    return NextResponse.json(
      {
        configured: true,
        connected: false,
        lastSuccessfulSync: null,
        error: "Gmail status could not be loaded. Check Supabase connectivity.",
      },
      { status: 503 },
    );
  }
}
