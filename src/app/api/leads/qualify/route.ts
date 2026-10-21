import { NextResponse } from "next/server";
import { createGeminiFactExtractor } from "@/lib/gemini";
import {
  QualificationError,
  runLeadQualification,
} from "@/lib/qualification";
import {
  AuthorizationError,
  authorizeActiveRepresentative,
} from "@/lib/supabase/authorization";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 12_000) {
    return NextResponse.json(
      { error: "Request body is too large." },
      { status: 413 },
    );
  }

  let requestText: string;
  try {
    requestText = await request.text();
  } catch {
    return NextResponse.json(
      { error: "Could not read request body." },
      { status: 400 },
    );
  }

  if (new TextEncoder().encode(requestText).byteLength > 12_000) {
    return NextResponse.json(
      { error: "Request body is too large." },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(requestText) as unknown;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;

  try {
    await authorizeActiveRepresentative(request);
    return NextResponse.json(
      await runLeadQualification(
        body,
        apiKey,
        apiKey ? createGeminiFactExtractor(apiKey) : async () => null,
      ),
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    if (error instanceof QualificationError) {
      const status =
        error.code === "invalid_request"
          ? 400
          : error.code === "missing_credentials"
            ? 503
            : error.code === "malformed_model_output"
              ? 502
              : 502;
      if (error.code === "model_unavailable") {
        console.error("[lead-qualification] Gemini request failed");
      }
      return NextResponse.json({ error: error.message }, { status });
    }

    console.error("[lead-qualification] Unexpected qualification failure");
    return NextResponse.json(
      { error: "Lead qualification failed unexpectedly. Please try again." },
      { status: 500 },
    );
  }
}
