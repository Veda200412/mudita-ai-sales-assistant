import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createCalendarAuthorizationUrl } from "@/lib/calendar/google-api";
import { createCalendarRepository } from "@/lib/calendar/repository";
import {
  AuthorizationError,
  authorizeActiveRepresentative,
} from "@/lib/supabase/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { userId } = await authorizeActiveRepresentative(request);
    const state = randomBytes(32).toString("base64url");
    const repository = createCalendarRepository(createSupabaseAdminClient());
    await repository.saveState(
      createHash("sha256").update(state).digest("hex"),
      userId,
      new Date(Date.now() + 10 * 60_000).toISOString(),
    );
    return NextResponse.json({
      authorizationUrl: createCalendarAuthorizationUrl(state),
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[calendar] OAuth connection could not be started");
    return NextResponse.json(
      { error: "Calendar connection could not be started. Check server configuration." },
      { status: 503 },
    );
  }
}
