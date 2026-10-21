# Architecture

## Dashboard and persistence

- `src/app` contains the Next.js App Router shell, health route, and authenticated API routes.
- `src/components/dashboard` contains the dashboard, explicit inquiry-save action, and test panel.
- `src/lib` contains business qualification, persistence orchestration, authorization, and Supabase clients.
- `supabase/migrations` contains the initial PostgreSQL schema and deny-by-default RLS setup.
- `docs/integrations.md` tracks integrations that are not configured yet.

The dashboard loads the latest persisted leads and associated messages, action logs, and summary counts from Supabase. It uses database-backed empty states and does not seed fabricated leads. The qualification analyzer remains non-persistent unless the user separately selects an accurate source channel and explicitly chooses “Save this inquiry as a real lead.”

## Authentication and authorization

The current MVP is intentionally single-workspace. Users are provisioned in Supabase Auth and linked to active `sales_representatives` rows through the existing `user_id` column. API routes verify the bearer token with Supabase Auth and check this representative link before using the server-only service-role client. There is no public self-registration. Because service-role access bypasses RLS, the authorization check is mandatory for every data route.

RLS stays enabled and the initial migration still has no permissive policies. The browser client accepts only the public URL and anon key; the service-role key is server-only. This single-workspace model does not provide tenant isolation and must not be used for multiple customer organizations. Add an organization/tenant model and restrictive RLS policies before multi-tenant deployment.

## Inquiry persistence and idempotency

`POST /api/leads` accepts a bounded inquiry, an explicitly selected existing channel, optional lead details, and a UUID `Idempotency-Key`. It authenticates the user, runs Gemini fact extraction, applies deterministic qualification, then stores the lead, inbound message, qualification evidence, and action log. Qualification statuses map to existing lead statuses: qualified → `qualified`, not qualified → `disqualified`, and needs more information → `follow_up`.

The migration already defines a unique constraint on `(channel, provider_message_id)`. For manually submitted inquiries the request idempotency key is stored in `provider_message_id`; retries therefore return the existing lead rather than create another. The workflow compensates by removing a newly inserted lead if its message insert fails. No schema change was required.

## Gmail inbound synchronization

The authenticated Gmail connection uses Google OAuth 2.0 with only the `gmail.readonly` scope. OAuth state is random, time-limited, single-use, and stored as a hash. Gmail access and refresh tokens are AES-256-GCM encrypted with `GMAIL_TOKEN_ENCRYPTION_KEY` before being written to the existing server-only `action_logs` table. The browser receives neither tokens nor service-role credentials.

`POST /api/gmail/sync` polls up to 50 inbox messages from the last 30 days, parses the Gmail message/thread IDs and MIME content, and stores inbound messages using the actual Gmail message ID as `provider_message_id`. `gmail_message_synced` action-log metadata maps Gmail thread IDs to leads; email addresses are never used to merge leads across threads or channels. The existing unique `(channel, provider_message_id)` constraint makes repeated polling idempotent. New inquiries run through the existing Gemini fact extractor and deterministic qualification policy. A persistence failure prevents the processed marker from being written and triggers best-effort rollback.

Configure the exact Google Cloud steps and local environment values in [integrations.md](./integrations.md). The implementation is not considered live until it has been connected to a test mailbox and manually verified.

## Booking safeguards

Google Calendar OAuth credentials are stored encrypted in the existing action log table, with hashed, single-use OAuth state. Authenticated calendar routes query live FreeBusy availability for the configured shared calendar; they do not infer availability from representative status. Booking creates a pending meeting, and only an explicit customer-confirmation action rechecks availability and inserts the real provider event. The event ID is deterministic per meeting, and the database meeting idempotency key plus unique external event ID protect retries. A retry after Google succeeds but Supabase fails fetches the same event rather than creating another. Confirmed meetings update the lead status and action log idempotently. This flow is implemented but still requires manual verification against a configured Google Calendar.

The dashboard includes a disabled human-takeover control only; persistent takeover controls are not implemented. Instagram/WhatsApp inbound and production representative assignment are also not implemented. Vercel deployment is not configured.
