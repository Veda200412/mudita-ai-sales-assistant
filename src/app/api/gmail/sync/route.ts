import { NextResponse } from "next/server";
import { createGeminiFactExtractor } from "@/lib/gemini";
import {
  decryptGmailTokens,
  encryptGmailTokens,
  type GmailTokens,
} from "@/lib/gmail/crypto";
import {
  getGmailMessage,
  getGmailMailboxEmail,
  GoogleOAuthError,
  listRecentGmailMessages,
  refreshGmailAccessToken,
} from "@/lib/gmail/google-api";
import { parseGmailMessage } from "@/lib/gmail/message-parser";
import {
  createGmailRepository,
  GmailDatabaseError,
} from "@/lib/gmail/repository";
import {
  GmailSyncError,
  runAuthenticatedGmailSync,
} from "@/lib/gmail/sync";
import { QualificationError } from "@/lib/qualification";
import {
  AuthorizationError,
  authorizeActiveRepresentative,
} from "@/lib/supabase/authorization";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function refreshAndPersist(
  repository: ReturnType<typeof createGmailRepository>,
  current: GmailTokens,
  actorUserId: string,
): Promise<GmailTokens> {
  try {
    const updated = await refreshGmailAccessToken(current.refreshToken);
    await repository.saveCredentials(encryptGmailTokens(updated), actorUserId);
    return updated;
  } catch (error) {
    if (error instanceof GoogleOAuthError && error.code === "invalid_grant") {
      await repository.saveConnectionStatus(
        actorUserId,
        "revoked",
        error.message,
      );
    }
    throw error;
  }
}

async function loadMailboxMessages(
  repository: ReturnType<typeof createGmailRepository>,
  actorUserId: string,
  tokens: GmailTokens,
) {
  let current =
    tokens.expiresAt < Date.now() + 60_000
      ? await refreshAndPersist(repository, tokens, actorUserId)
      : tokens;
  try {
    const mailboxEmail = await getGmailMailboxEmail(current.accessToken);
    const references = await listRecentGmailMessages(current.accessToken);
    const messages = [];
    for (const reference of references) {
      const rawMessage = await getGmailMessage(current.accessToken, reference.id);
      const parsed = parseGmailMessage(rawMessage, mailboxEmail);
      if (!parsed) {
        throw new GmailSyncError(
          "gmail_failure",
          "Gmail returned a message without a usable message or thread ID.",
        );
      }
      messages.push(parsed);
    }
    messages.sort((left, right) => left.sentAt.localeCompare(right.sentAt));
    return { messages, tokens: current };
  } catch (error) {
    if (!(error instanceof GoogleOAuthError) || error.status !== 401) {
      throw error;
    }
    current = await refreshAndPersist(repository, current, actorUserId);
    const mailboxEmail = await getGmailMailboxEmail(current.accessToken);
    const references = await listRecentGmailMessages(current.accessToken);
    const messages = [];
    for (const reference of references) {
      const rawMessage = await getGmailMessage(current.accessToken, reference.id);
      const parsed = parseGmailMessage(rawMessage, mailboxEmail);
      if (!parsed) {
        throw new GmailSyncError(
          "gmail_failure",
          "Gmail returned a message without a usable message or thread ID.",
        );
      }
      messages.push(parsed);
    }
    messages.sort((left, right) => left.sentAt.localeCompare(right.sentAt));
    return { messages, tokens: current };
  }
}

export async function POST(request: Request) {
  let actorUserId: string | null = null;
  let repository: ReturnType<typeof createGmailRepository> | null = null;
  try {
    const actor = await authorizeActiveRepresentative(request);
    actorUserId = actor.userId;
    const gmailRepository = createGmailRepository(createSupabaseAdminClient());
    repository = gmailRepository;
    const apiKey = process.env.GEMINI_API_KEY;
    const synced = await runAuthenticatedGmailSync({
      authenticate: async () => actor,
      fetchMessages: async (userId) => {
        const stored = await gmailRepository.getCredentials();
        if (!stored) {
          throw new GmailSyncError(
            "gmail_failure",
            "Connect a Gmail mailbox before syncing email.",
          );
        }
        const tokens = decryptGmailTokens(stored.encryptedCredentials);
        return (await loadMailboxMessages(gmailRepository, userId, tokens)).messages;
      },
      repository: gmailRepository.syncRepository,
      apiKey,
      extractFacts: apiKey
        ? createGeminiFactExtractor(apiKey)
        : async () => null,
    });
    actorUserId = synced.actorUserId;
    await gmailRepository.saveSyncStatus(
      synced.actorUserId,
      "success",
      synced.result,
    );
    return NextResponse.json(synced.result);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (
      error instanceof GmailSyncError &&
      error.code === "sync_in_progress"
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: 409 },
      );
    }

    const errorMessage =
      error instanceof GmailSyncError ||
      error instanceof GoogleOAuthError ||
      error instanceof GmailDatabaseError
        ? error.message
        : "Gmail synchronization failed. Check server configuration and retry.";
    if (actorUserId && repository) {
      try {
        await repository.saveSyncStatus(actorUserId, "error", {
          error: errorMessage,
        });
      } catch {
        console.error("[gmail] Failed to record synchronization error");
      }
    }
    if (error instanceof GoogleOAuthError) {
      console.error("[gmail] Google API request failed", {
        code: error.code,
        status: error.status ?? "unknown",
      });
    } else if (
      error instanceof GmailSyncError &&
      error.code === "qualification_failure"
    ) {
      console.error("[gmail] Email qualification failed", {
        code:
          error.cause instanceof QualificationError
            ? error.cause.code
            : "qualification_failure",
      });
    } else if (!(error instanceof GmailSyncError)) {
      console.error("[gmail] Synchronization failed");
    }
    return NextResponse.json(
      { error: errorMessage },
      {
        status:
          error instanceof GmailDatabaseError
            ? 503
            : error instanceof GmailSyncError &&
                error.code === "gmail_failure" &&
                error.message.startsWith("Connect a Gmail")
              ? 409
            : error instanceof GmailSyncError &&
                error.code === "persistence_failure"
              ? 503
              : error instanceof GoogleOAuthError &&
                  error.code === "rate_limited"
                ? 429
                : error instanceof AuthorizationError
                  ? error.status
                  : 502,
      },
    );
  }
}
