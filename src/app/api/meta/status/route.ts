import { NextResponse } from "next/server";
import { getMissingEnvironmentVariables } from "@/lib/config";
import { createMetaChannelStatus } from "@/lib/meta/status";
import {
  AuthorizationError,
  authorizeActiveRepresentative,
} from "@/lib/supabase/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const channels = [
  {
    channel: "instagram" as const,
    actionType: "instagram_message_synced",
  },
  {
    channel: "whatsapp" as const,
    actionType: "whatsapp_message_synced",
  },
];

const requiredEnvironment = [
  "metaAppSecret",
  "metaVerifyToken",
  "geminiApiKey",
  "supabaseUrl",
  "supabaseAnonKey",
  "supabaseServiceRoleKey",
] as const;

export async function GET(request: Request) {
  try {
    await authorizeActiveRepresentative(request);
    const client = createSupabaseAdminClient();
    const missing = getMissingEnvironmentVariables(requiredEnvironment);
    const channelStatuses = await Promise.all(
      channels.map(async ({ channel, actionType }) => {
        const { data, error } = await client
          .from("action_logs")
          .select("created_at")
          .eq("action_type", actionType)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) {
          console.error("[meta-status] Webhook activity lookup failed", {
            channel,
            code: error.code ?? "unknown",
          });
          throw new Error("Meta webhook activity is unavailable.");
        }
        return createMetaChannelStatus({
          channel,
          missingVariables: missing,
          lastWebhookEventAt: data?.created_at ?? null,
        });
      }),
    );
    return NextResponse.json({ callbackPath: "/api/meta/webhook", channels: channelStatuses });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[meta-status] Integration status could not be loaded");
    return NextResponse.json(
      { error: "Meta integration status could not be loaded." },
      { status: 503 },
    );
  }
}
