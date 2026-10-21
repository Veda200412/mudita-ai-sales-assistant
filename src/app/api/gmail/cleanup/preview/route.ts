import { NextResponse } from "next/server";
import { classifyCleanupLead, runAuthenticatedCleanupPreview } from "@/lib/gmail/cleanup";
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

async function getMailboxEmail(
  gmailRepository: ReturnType<typeof createGmailRepository>,
  actorUserId: string,
): Promise<string> {
  const stored = await gmailRepository.getCredentials();
  if (!stored) {
    throw new GoogleOAuthError(
      "gmail_api_failure",
      "Connect a Gmail mailbox before previewing historical email cleanup.",
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
    const client = createSupabaseAdminClient();
    const gmailRepository = createGmailRepository(client);
    const cleanupRepository = createGmailCleanupRepository(client);
    const mailboxEmail = await getMailboxEmail(gmailRepository, actor.userId);
    const preview = await runAuthenticatedCleanupPreview({
      authenticate: async () => actor,
      loadLeads: async () => cleanupRepository.loadLeads(mailboxEmail),
      classify: classifyCleanupLead,
    });
    const previewId = await cleanupRepository.createPreview(
      preview.actorUserId,
      preview.items,
    );
    return NextResponse.json({
      previewId,
      items: preview.items,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof GoogleOAuthError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[gmail-cleanup] Preview failed");
    return NextResponse.json(
      { error: "Historical Gmail cleanup preview could not be created." },
      { status: 503 },
    );
  }
}
