import { NextResponse } from "next/server";
import { createGeminiFactExtractor } from "@/lib/gemini";
import {
  ingestMetaMessages,
  MetaInboundPersistenceError,
} from "@/lib/meta/ingest";
import {
  MetaWebhookError,
  parseMetaWebhookPayload,
  verifyMetaChallenge,
  verifyMetaSignatureWithReason,
} from "@/lib/meta/webhook";
import { createMetaWebhookRepository, MetaWebhookDatabaseError } from "@/lib/meta/repository";
import { QualificationError } from "@/lib/qualification";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maximumBodyBytes = 1_000_000;

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const challenge = verifyMetaChallenge({
      mode: query.get("hub.mode"),
      token: query.get("hub.verify_token"),
      challenge: query.get("hub.challenge"),
      configuredToken: process.env.META_VERIFY_TOKEN,
    });
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    if (error instanceof MetaWebhookError) {
      console.warn("[meta-webhook] Request rejected", {
        category: error.code,
      });
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "configuration" ? 503 : 403 },
      );
    }
    console.error("[meta-webhook] Verification request failed");
    return NextResponse.json(
      { error: "Meta webhook verification failed." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > maximumBodyBytes) {
      return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
    }
    const rawBody = Buffer.from(await request.arrayBuffer());
    if (rawBody.byteLength > maximumBodyBytes) {
      return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as unknown;
    } catch {
      throw new MetaWebhookError("payload", "Webhook body must be valid JSON.");
    }
    const object =
      typeof payload === "object" && payload !== null && "object" in payload
        ? payload.object
        : null;
    const channel =
      object === "instagram"
        ? "instagram"
        : object === "whatsapp_business_account"
          ? "whatsapp"
          : null;
    if (!channel) {
      throw new MetaWebhookError("payload", "Unsupported Meta webhook object.");
    }
    const channelAppSecret =
      channel === "instagram"
        ? process.env.META_INSTAGRAM_APP_SECRET
        : process.env.META_WHATSAPP_APP_SECRET;
    const appSecret = channelAppSecret?.trim()
      ? channelAppSecret
      : process.env.META_APP_SECRET;
    const signatureResult = verifyMetaSignatureWithReason(
      rawBody,
      request.headers.get("x-hub-signature-256"),
      appSecret,
    );
    if (!signatureResult.valid) {
      console.warn("[meta-webhook] Signature rejected", {
        channel,
        reason: signatureResult.reason,
      });
      return NextResponse.json({ error: "Meta webhook signature is invalid." }, { status: 401 });
    }
    const messages = parseMetaWebhookPayload(payload, channel);
    if (messages.length === 0) {
      return NextResponse.json({ received: 0, imported: 0, duplicates: 0 });
    }
    const apiKey = process.env.GEMINI_API_KEY;
    const result = await ingestMetaMessages({
      messages,
      repository: createMetaWebhookRepository(createSupabaseAdminClient()),
      apiKey,
      extractFacts: apiKey ? createGeminiFactExtractor(apiKey) : async () => null,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MetaWebhookError) {
      console.warn("[meta-webhook] Request rejected", {
        category: error.code,
      });
      return NextResponse.json(
        { error: error.message },
        {
          status:
            error.code === "configuration"
              ? 503
              : error.code === "signature"
                ? 401
                : error.code === "verification"
                  ? 403
                  : 400,
        },
      );
    }
    if (error instanceof MetaWebhookDatabaseError || error instanceof MetaInboundPersistenceError) {
      console.error("[meta-webhook] Persistence failed", {
        category: error.name,
      });
      return NextResponse.json(
        { error: "Inbound message could not be saved. Meta may retry the event." },
        { status: 503 },
      );
    }
    if (error instanceof QualificationError) {
      console.error("[meta-webhook] Qualification failed", { code: error.code });
      return NextResponse.json(
        { error: "Inbound message qualification failed. Meta may retry the event." },
        { status: 503 },
      );
    }
    console.error("[meta-webhook] Unexpected webhook processing failure");
    return NextResponse.json(
      { error: "Meta webhook could not be processed." },
      { status: 500 },
    );
  }
}
