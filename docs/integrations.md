# Integration status and local Gmail setup

| Integration | Current status | Required next work |
| --- | --- | --- |
| Supabase | Authenticated single-workspace lead/message persistence and dashboard reads implemented; project credentials and representative links must be configured | Provision Supabase Auth users and link active representative rows; add tenant-scoped authorization/RLS before multi-tenant use |
| Gemini | Server-side extraction and deterministic qualification implemented using Gemini 3.5 Flash-Lite through the Interactions API | Configure `GEMINI_API_KEY`; no external API calls are made by automated tests |
| Google Calendar | OAuth/API and booking flow implemented; not verified against a live calendar | Configure Google Cloud OAuth and a test calendar, then manually verify availability, confirmation, and duplicate handling |
| Instagram / WhatsApp | Inbound webhook code implemented; not connected or live-verified | Configure Meta app/accounts, permissions, public HTTPS webhook, and verify actual messages |
| Gmail | OAuth/API integration implemented; not verified against a live mailbox | Configure Google Cloud OAuth and server-only Gmail variables; connect a test mailbox and verify local sync |
| Vercel | Not deployed | Configure deployment and server-only environment variables |

The health route does not use privileged credentials. Customer data routes require a valid Supabase Auth access token and an active representative link before the server-only admin client is used. Gmail's read-only integration is implemented but has not been verified against a live mailbox. No email is sent or auto-replied to.

Gemini extraction uses the hard-coded `gemini-3.5-flash-lite` model ID in `src/lib/config.ts`; it is not configurable with an environment variable. The server uses the official `@google/genai` SDK's Interactions API with a JSON `response_format` schema. See Google's [Gemini 3.5 Flash-Lite model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [Interactions API documentation](https://ai.google.dev/gemini-api/docs/interactions), and [structured output documentation](https://ai.google.dev/gemini-api/docs/structured-output). `GEMINI_API_KEY` remains server-only.

## Configure a Google Cloud test mailbox

1. In [Google Cloud Console](https://console.cloud.google.com/), select or create a project, enable **Gmail API**, and configure the OAuth consent screen.
2. For local testing, use an **External** audience and add the test Gmail account under **Test users**. Keep the app in Testing; do not publish it for this MVP.
3. Create an OAuth client ID with application type **Web application**.
4. Set its authorized JavaScript origin to `http://localhost:3000` and its authorized redirect URI to exactly `http://localhost:3000/api/gmail/callback`.
5. Request only the Gmail read-only scope: `https://www.googleapis.com/auth/gmail.readonly`. The app does not request send or modify scopes.
6. Copy the generated client ID and client secret into the server-side `.env.local`. Create a separate random 32-byte encryption key in PowerShell:

   ```powershell
   $bytes = New-Object byte[] 32
   $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
   $rng.GetBytes($bytes)
   [Convert]::ToBase64String($bytes)
   ```

   Store that generated value as `GMAIL_TOKEN_ENCRYPTION_KEY`. It must be backed up securely and kept stable; changing it makes already stored tokens undecryptable.

7. Configure these values in `.env.local` (never add real values to source control):

   ```dotenv
   GMAIL_CLIENT_ID=<OAuth web client ID>
   GMAIL_CLIENT_SECRET=<OAuth web client secret>
   GMAIL_REDIRECT_URI=http://localhost:3000/api/gmail/callback
   GMAIL_TOKEN_ENCRYPTION_KEY=<generated base64 32-byte key>
   GEMINI_API_KEY=<server-side Gemini API key>
   ```

   The Supabase values `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are also needed. Keep `SUPABASE_SERVICE_ROLE_KEY`, `GMAIL_CLIENT_SECRET`, `GMAIL_TOKEN_ENCRYPTION_KEY`, and all OAuth tokens server-side; do not prefix them with `NEXT_PUBLIC_`.

8. Restart `npm run dev`, sign in as an active representative, click **Connect Gmail**, and approve access using the test account. Send an actual test inquiry to that mailbox, then click **Sync email**. Verify the real message is visible in the dashboard conversation and that another sync reports it as already imported.

The sync polls at most the 50 most recent inbox messages from the last 30 days. It stores the Gmail message ID in `messages.provider_message_id` and uses the Gmail thread ID in server-side action-log metadata to continue the same email conversation. Thread mappings do not combine different channels or Gmail threads by sender address. OAuth credentials are encrypted before storage in `action_logs`; no migration is required. Revoked authorization must be reconnected from the dashboard.

Inbound messages with Gmail bulk/list/auto-response headers, obvious automated sender names, recognized Google notification subjects, Glassdoor/job-alert indicators, a missing sender email, or the connected mailbox as sender are not treated as sales inquiries. Each is recorded once as a `gmail_message_ignored` action-log outcome (including a reason), without creating a lead or message; the sync card reports ignored and repeated counts. Other messages still use the normal deterministic qualification policy, so missing qualification evidence remains follow-up rather than being inferred. Gmail imports are not automatically assigned: routing requires an explicit representative availability result, and active-account status alone is not availability.

For historical Gmail leads, the dashboard provides **Preview cleanup**. It reuses the deterministic Gmail classifier on stored message metadata and presents likely non-sales/automated records, potential inquiries, and records needing manual review. It does not use an LLM or change lead/message records during preview; it stores only the preview workflow snapshot in `action_logs`. An absent lead display name does not by itself force manual review when complete synced-message metadata can classify every message; missing sender or thread metadata remains manual review. Only explicitly selected likely non-sales records can be confirmed; the confirmation records `gmail_cleanup_ignored` action-log entries and hides those leads from the active Leads dashboard. Original leads, statuses, qualification evidence, messages, provider message IDs, Gmail thread IDs, and synced action logs are retained. Each preview and confirmation is tied to the authenticated active representative; repeated confirmation of the same preview is idempotent. No schema migration is required.

## Instagram and WhatsApp inbound webhooks

Both inbound channels use `POST /api/meta/webhook` and the same server-side Meta app secret. GET verification uses `META_VERIFY_TOKEN`; POST authenticity is checked against Meta's `X-Hub-Signature-256` HMAC-SHA256 header over the exact raw request body. A missing secret rejects POST requests. A missing/mismatched verify token rejects GET verification. Expose this route through a public HTTPS URL for Meta; for local tests use a trusted HTTPS tunnel and set its exact callback URL in the Meta developer console.

Required server variables:

```dotenv
META_APP_SECRET=<Meta app secret>
META_VERIFY_TOKEN=<random value you choose and enter in Meta webhook setup>
GEMINI_API_KEY=<server-side Gemini key>
NEXT_PUBLIC_SUPABASE_URL=<Supabase project URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<Supabase anon key>
SUPABASE_SERVICE_ROLE_KEY=<server-only Supabase service role key>
```

`META_APP_ID` identifies the app in Meta setup but is not needed by this inbound webhook implementation. `META_ACCESS_TOKEN` is included for future server-side Graph API calls; inbound-only processing does not call Graph API or require that token. Never put any Meta secret/access token in browser variables or source control.

### Instagram Messaging

1. Use a Meta developer app with the Messenger API for Instagram / Instagram Messaging product enabled.
2. Use an Instagram **Professional** account (Business or Creator) connected to the appropriate Facebook Page for the selected Meta login product.
3. Configure the product's message permissions (for the Facebook Login/Messenger API flow this includes `instagram_manage_messages`, `instagram_basic`, and the required Page webhook/subscription permissions such as `pages_manage_metadata`). Meta may require app review and business verification before users outside development/test roles can use the integration.
4. Subscribe the app to the Instagram `messages` webhook field. In **Webhooks**, set callback to `https://<your-host>/api/meta/webhook`, enter the same random value as `META_VERIFY_TOKEN`, and subscribe the Instagram object to `messages`.
5. Set `META_APP_SECRET` from **App settings → Basic** in the server `.env.local`, configure the verify token, restart the app, and complete Meta's GET verification.

The handler ignores echoes, stores incoming Instagram provider message IDs, and scopes conversation mapping to recipient-account ID plus sender ID. It does not send replies or retrieve media.

### WhatsApp Cloud API

1. Add the **WhatsApp** product to the Meta app, create/select a WhatsApp Business Account (WABA), and attach a registered business phone number. Meta's test WABA/test number can be used during development; production messaging may require business verification and number approval.
2. In **Webhooks**, use the same callback URL `https://<your-host>/api/meta/webhook` and `META_VERIFY_TOKEN`; subscribe the `whatsapp_business_account` object to the `messages` field and subscribe the app to the WABA.
3. Set `META_APP_SECRET` and `META_VERIFY_TOKEN` server-side. A Cloud API system-user/access token is not used for inbound webhook verification or storage; `META_ACCESS_TOKEN` is intentionally optional while the app sends no messages. Keep any issued token server-side.
4. For local testing, expose `localhost:3000` over a trusted public HTTPS tunnel and configure that exact URL in Meta. Restart `npm run dev` after changing environment variables.

The handler stores incoming WhatsApp message IDs and scopes each conversation by phone-number ID plus sender ID. Text and interactive reply text are qualified; media-only events are retained as follow-up with explicit missing-content evidence. No reply is sent.

### Webhook validation steps and current status

1. Configure Supabase, `GEMINI_API_KEY`, `META_APP_SECRET`, and `META_VERIFY_TOKEN` in server `.env.local`; do not copy real values into `.env.example`.
2. Start the app and expose `https://<host>/api/meta/webhook`; complete GET verification separately for Instagram and WhatsApp in Meta.
3. Send an actual inbound message from an authorized test account. Verify the matching channel, message provider ID, conversation grouping, and `instagram_message_synced` or `whatsapp_message_synced` action log in Supabase.
4. Deliver/retry the same event and verify no duplicate message or lead is created. Enable workspace or per-lead takeover and verify ingestion continues while assignment is recorded as paused. Verify no reply is sent.

Automated tests mock Meta and Supabase; no Meta credentials, app approval, professional Instagram account, WABA, public webhook, or live message test has been supplied or verified. Until those manual steps pass, both integrations remain unverified. Meta's review/permission requirements depend on the selected Instagram login product and intended users.

## Google Calendar booking

In Google Cloud, enable the **Google Calendar API**, configure the OAuth consent screen, add your test Google account as a test user if the app is in Testing, and create an OAuth **Web application** client. Set the authorized redirect URI exactly to `http://localhost:3000/api/calendar/callback`. Grant only `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/calendar.freebusy`. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GOOGLE_CALENDAR_ID` in server `.env.local`; the latter may be `primary` or the calendar's ID. The calendar OAuth tokens are encrypted server-side with the existing 32-byte `GMAIL_TOKEN_ENCRYPTION_KEY`; no token reaches the browser.

The selected lead's Calendar panel requests live FreeBusy slots in the policy's Monday-Friday 10:00-18:00 Asia/Kolkata window, with 30-minute slots. A selected slot creates a `pending_confirmation` meeting only after rechecking availability. After the representative records the customer's explicit confirmation, a second request rechecks availability, creates the real Google Calendar event, and marks the meeting confirmed. Repeated booking submissions use the database idempotency key; event IDs are deterministic per meeting, so retry after a provider/database interruption does not create a second event. This is a single configured shared calendar, not per-representative calendars. No invitation email is sent by this flow. Live setup and provider behavior remain unverified until tested with the configured Google account.

Manual verification: restart `npm run dev`, sign in as an active representative, connect Calendar in a qualified lead's Calendar panel, check availability for a weekday, and compare displayed slots to the test calendar. Request a slot and confirm it remains pending; do not confirm until the customer has explicitly agreed. Then confirm and verify the event exists in Google Calendar and the lead becomes Meeting Booked. Repeat the confirmation or retry the same booking request and verify one meeting/event remains. Also occupy a proposed slot in Google Calendar and verify the next availability check omits it. The flow does not send invitations.

### Gmail OAuth callback troubleshooting

The Gmail callback reads the case-sensitive `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, and `GMAIL_TOKEN_ENCRYPTION_KEY` variables. Generic `GOOGLE_*` variables do not configure this Gmail integration. The redirect URI must exactly match the Google Cloud OAuth client's callback URL.

`GMAIL_TOKEN_ENCRYPTION_KEY` must be base64 that decodes to exactly 32 bytes. The callback reports a server-side failure stage and a sanitized message without logging OAuth codes, tokens, secrets, encryption keys, or callback URLs. If the key was changed after credentials were saved, those credentials cannot be decrypted; reconnect the mailbox after setting a valid stable key.

Automated tests mock the Gmail API and do not require a Google account. The integration is not considered live until the manual test above succeeds against the configured test mailbox.
