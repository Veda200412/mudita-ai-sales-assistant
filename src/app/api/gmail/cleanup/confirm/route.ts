import { NextResponse } from "next/server";
import {
  runAuthenticatedCleanupConfirmation,
} from "@/lib/gmail/cleanup";
import { createGmailCleanupRepository } from "@/lib/gmail/cleanup-repository";
import { decryptGmailTokens, encryptGmailTokens } from "@/lib/gmail/crypto";
import {
  getGmailMailboxEmail,
  GoogleOAuthError,
  refreshGmailAccessToken,
} from "@/lib/gmail/google-api";
import { createGmailRepository } from "@/lib/gmail/repository";
import {
  AuthorizationError,
  authorizeActiveRepresentative,
} from "@/lib/supabase/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

async function getMailboxEmail(
  gmailRepository: ReturnType<typeof createGmailRepository>,
  actorUserId: string,
): Promise<string> {
  const stored = await gmailRepository.getCredentials();
  if (!stored) {
    throw new GoogleOAuthError(
      "gmail_api_failure",
      "Connect a Gmail mailbox before confirming historical email cleanup.",
    );
  }
  let tokens = decryptGmailTokens(stored.encryptedCredentials);
  if (tokens.expiresAt < Date.now() + 60_000) {
    tokens = await refreshGmailAccessToken(tokens.refreshToken);
    await gmailRepository.saveCredentials(encryptGmailTokens(tokens), actorUserId);
  }
  try {
    return await getGmailMailboxEmail(tokens.accessToken);
  } catch (error) {
    if (!(error instanceof GoogleOAuthError) || error.status !== 401) {
      throw error;
    }
    tokens = await refreshGmailAccessToken(tokens.refreshToken);
    await gmailRepository.saveCredentials(encryptGmailTokens(tokens), actorUserId);
    return getGmailMailboxEmail(tokens.accessToken);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await authorizeActiveRepresentative(request);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 100_000) {
      return NextResponse.json(
        { error: "Cleanup confirmation payload is too large." },
        { status: 413 },
      );
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Cleanup confirmation must be valid JSON." },
        { status: 400 },
      );
    }
    if (
      !isRecord(body) ||
      !isUuid(body.previewId) ||
      !Array.isArray(body.selectedLeadIds) ||
      body.selectedLeadIds.length < 1 ||
      body.selectedLeadIds.length > 500 ||
      !body.selectedLeadIds.every(isUuid) ||
      new Set(body.selectedLeadIds).size !== body.selectedLeadIds.length
    ) {
      return NextResponse.json(
        { error: "Select one or more valid leads from the cleanup preview." },
        { status: 400 },
      );
    }
    const previewId = body.previewId;
    const selectedLeadIds = body.selectedLeadIds as string[];
    const client = createSupabaseAdminClient();
    const gmailRepository = createGmailRepository(client);
    const cleanupRepository = createGmailCleanupRepository(client);
    const result = await runAuthenticatedCleanupConfirmation({
      authenticate: async () => actor,
      previewId,
      selectedLeadIds,
      repository: {
        getPreview: (id, userId) => cleanupRepository.getPreview(id, userId),
        claimPreview: (id, userId, ids) =>
          cleanupRepository.claimPreview(id, userId, ids),
        hasIgnoredMarker: (leadId) =>
          cleanupRepository.hasIgnoredMarker(leadId),
        recordIgnored: (userId, id, item) =>
          cleanupRepository.recordIgnored(userId, id, item),
        recordSummary: (userId, id, ids) =>
          cleanupRepository.recordConfirmationSummary(userId, id, ids),
        updatePreviewStatus: (id, userId, state, ids) =>
          cleanupRepository.updatePreviewStatus(id, userId, state, ids),
      },
      loadLeads: async () => {
        const mailboxEmail = await getMailboxEmail(
          gmailRepository,
          actor.userId,
        );
        return cleanupRepository.loadLeads(mailboxEmail, true);
      },
    });
    return NextResponse.json({
      alreadyConfirmed: result.alreadyConfirmed,
      ignored: result.ignored,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof GoogleOAuthError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof Error) {
      if (error.message.includes("not found")) {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      if (
        error.message.includes("already in progress") ||
        error.message.includes("changed since preview") ||
        error.message.includes("original cleanup selection") ||
        error.message.includes("Confirmed cleanup selection") ||
        error.message.includes("not ready")
      ) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      if (
        error.message.includes("Only previewed") ||
        error.message.includes("selected")
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    console.error("[gmail-cleanup] Confirmation failed");
    return NextResponse.json(
      { error: "Historical Gmail cleanup could not be confirmed. Retry the same preview if needed." },
      { status: 503 },
    );
  }
}
