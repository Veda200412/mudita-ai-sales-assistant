import { NextResponse } from "next/server";
import { createGeminiFactExtractor } from "@/lib/gemini";
import {
  LeadPersistenceError,
  qualifyAndPersistLead,
} from "@/lib/lead-persistence";
import {
  AuthorizationError,
  authorizeActiveRepresentative,
} from "@/lib/supabase/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { createLeadPersistenceRepository } from "@/lib/supabase/lead-repository";
import { QualificationError } from "@/lib/qualification";
import { runAuthorizedRepresentativeAction } from "@/lib/representative-assignment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const maximumBodyBytes = 12_000;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maximumBodyBytes) {
    return NextResponse.json(
      { error: "Request body is too large." },
      { status: 413 },
    );
  }

  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return NextResponse.json(
      { error: "Could not read request body." },
      { status: 400 },
    );
  }
  if (new TextEncoder().encode(bodyText).byteLength > maximumBodyBytes) {
    return NextResponse.json(
      { error: "Request body is too large." },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText) as unknown;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const result = await runAuthorizedRepresentativeAction(
      request,
      authorizeActiveRepresentative,
      (userId) =>
        qualifyAndPersistLead(
          body,
          idempotencyKey,
          userId,
          apiKey,
          apiKey ? createGeminiFactExtractor(apiKey) : async () => null,
          createLeadPersistenceRepository(createSupabaseAdminClient()),
        ),
    );

    console.info("[lead-persistence] Inquiry persistence completed", {
      channel:
        typeof body === "object" &&
        body !== null &&
        "channel" in body &&
        typeof body.channel === "string"
          ? body.channel
          : "unknown",
      leadStatus: result.lead.status,
      qualificationStatus: result.qualification?.finalStatus ?? "not_recomputed",
      duplicate: result.duplicate,
      actionLogRecorded: result.actionLogRecorded,
    });

    return NextResponse.json(
      {
        leadId: result.lead.id,
        status: result.lead.status,
        duplicate: result.duplicate,
        qualification: result.qualification,
        actionLogRecorded: result.actionLogRecorded,
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    if (error instanceof LeadPersistenceError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "invalid_request" ? 400 : 503 },
      );
    }
    if (error instanceof QualificationError) {
      const status =
        error.code === "invalid_request"
          ? 400
          : error.code === "missing_credentials"
            ? 503
            : 502;
      if (error.code === "model_unavailable") {
        console.error("[lead-persistence] Gemini extraction failed");
      }
      return NextResponse.json({ error: error.message }, { status });
    }

    console.error("[lead-persistence] Unexpected persistence failure");
    return NextResponse.json(
      { error: "The inquiry could not be saved. Please try again." },
      { status: 500 },
    );
  }
}
