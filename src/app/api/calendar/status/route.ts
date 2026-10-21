import { NextResponse } from "next/server";
import { getMissingEnvironmentVariables } from "@/lib/config";
import { getCalendarId } from "@/lib/calendar/service";
import { createCalendarRepository } from "@/lib/calendar/repository";
import {
  AuthorizationError,
  authorizeActiveRepresentative,
} from "@/lib/supabase/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await authorizeActiveRepresentative(request);
    const missing = getMissingEnvironmentVariables([
      "googleClientId",
      "googleClientSecret",
      "googleRedirectUri",
      "googleCalendarId",
      "gmailTokenEncryptionKey",
    ]);
    if (missing.length > 0) {
      return NextResponse.json({
        configured: false,
        connected: false,
        error: `Complete server setup for ${missing.join(", ")}.`,
      });
    }
    getCalendarId();
    const credentials = await createCalendarRepository(
      createSupabaseAdminClient(),
    ).getCredentials();
    return NextResponse.json({
      configured: true,
      connected: Boolean(credentials?.encryptedCredentials),
      error: null,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[calendar] Status could not be loaded");
    return NextResponse.json(
      {
        configured: true,
        connected: false,
        error: "Calendar status could not be loaded. Check Supabase connectivity.",
      },
      { status: 503 },
    );
  }
}
