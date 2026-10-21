import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { encryptCalendarTokens } from "@/lib/calendar/crypto";
import {
  CalendarApiError,
  exchangeCalendarCode,
} from "@/lib/calendar/google-api";
import { createCalendarRepository } from "@/lib/calendar/repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function redirect(result: string) {
  const configured = process.env.GOOGLE_REDIRECT_URI;
  const origin = configured ? new URL(configured).origin : "http://localhost:3000";
  const target = new URL("/", origin);
  target.searchParams.set("calendar", result);
  return NextResponse.redirect(target);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code || url.searchParams.has("error")) {
    return redirect("error");
  }
  let userId: string | null = null;
  try {
    const repository = createCalendarRepository(createSupabaseAdminClient());
    const consumed = await repository.consumeState(
      createHash("sha256").update(state).digest("hex"),
    );
    if (!consumed) return redirect("error");
    userId = consumed.userId;
    const { data: representative, error } = await createSupabaseAdminClient()
      .from("sales_representatives")
      .select("id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (error || !representative) return redirect("error");
    const tokens = await exchangeCalendarCode(code);
    await repository.saveCredentials(
      encryptCalendarTokens(tokens),
      userId,
    );
    await repository.recordAction({
      actorUserId: userId,
      leadId: null,
      actionType: "calendar_connected",
      summary: "Google Calendar connected with availability and event permissions.",
      metadata: { scopes: ["calendar.events", "calendar.freebusy"] },
    });
    return redirect("connected");
  } catch (error) {
    console.error("[calendar] OAuth callback failed", {
      category:
        error instanceof CalendarApiError
          ? error.code ?? "oauth_failure"
          : "callback_failure",
      status: error instanceof CalendarApiError ? error.status ?? "unknown" : "unknown",
    });
    if (userId) {
      try {
        const repository = createCalendarRepository(createSupabaseAdminClient());
        await repository.recordAction({
          actorUserId: userId,
          leadId: null,
          actionType: "calendar_connection_error",
          summary: "Google Calendar connection failed.",
          metadata: { error: "Reconnect and check server configuration." },
        });
      } catch {
        console.error("[calendar] OAuth failure could not be recorded");
      }
    }
    return redirect("error");
  }
}
