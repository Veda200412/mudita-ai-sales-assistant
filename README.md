# Mudita AI Sales Assistant

The first working stage of a sales operations dashboard built with Next.js App Router, TypeScript, Tailwind CSS, and Supabase.

## Requirements

- Node.js 20.9 or newer
- npm
- A Supabase project is optional for running the dashboard shell.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and configure the Supabase URL, anon key, service-role key, and Gemini API key. Keep `.env.local` out of version control.

3. Apply `supabase/migrations/001_initial_schema.sql` to your Supabase project if it has not already been applied.

4. Create each sales representative in Supabase Auth, then link the Auth user to an active `sales_representatives` row by setting its `user_id`. Do not enable public self-registration for this single-workspace MVP.

5. Start the development server:

   ```bash
   npm run dev
   ```

6. Visit `http://localhost:3000` and sign in using the provisioned Auth account. Check `http://localhost:3000/api/health` for non-secret integration status.

7. To test real inbound email, configure a Google Cloud OAuth client and the Gmail environment values described in [docs/integrations.md](./docs/integrations.md). Connect the test mailbox from the authenticated Gmail integration card, then use **Sync email**. This feature only reads Gmail and never sends or auto-replies.

No example customer records are seeded or shown. Without Supabase configuration, authentication, and an active representative link, the dashboard cannot load or persist customer records.

## Environment variables

See `.env.example` for supported variable names. Next.js automatically loads `.env.local` for development, build, and start commands. Gemini runs only on the server. Browser sign-in uses Supabase Auth and the anon key; each data request sends the short-lived access token to the server, which verifies it and confirms that the user is linked to an active sales representative before using the server-only service-role key. The service-role key is never bundled into browser code. RLS remains enabled with no permissive policies; service-role access is guarded by this server-side authentication and single-workspace representative authorization. The health endpoint uses only the public anon key.

## Current scope

Implemented:

- Responsive dashboard with authenticated persisted lead, message, and action-log loading; lead search/status filters and database-backed empty states.
- Typed lead, message, meeting, representative, and action-log models.
- Server-rendered Insight Analytics business policy with deterministic qualification and availability-aware representative routing.
- Server-side Gemini extraction at `POST /api/leads/qualify`; final status is always calculated by deterministic policy code.
- A non-persistent qualification test panel plus a separate, explicit action to save the analyzed inquiry as a real lead.
- Authenticated `POST /api/leads` that qualifies and persists a lead, inbound message, evidence, and action log. Retries use a UUID `Idempotency-Key` stored in the existing unique `(channel, provider_message_id)` constraint.
- Authenticated `GET /api/dashboard` for leads, conversation history, action logs, and summary counts.
- Initial Supabase schema with foreign keys, constraints, indexes, RLS enabled, and no permissive customer-data policies.
- Server-only Supabase admin-client and a public-key-only browser client.
- `/api/health`, which reports configuration readiness without making external API calls.
- Google Calendar OAuth, live FreeBusy availability, pending confirmation, and idempotent event booking are implemented; see [docs/integrations.md](./docs/integrations.md). Live Google verification is still required.
- Existing Gmail cleanup supports a dry-run review and explicit confirmation; unnamed records are only eligible when complete synced-message evidence independently identifies them as automated. Confirmed records remain preserved and hidden through action-log markers.
- Instagram and WhatsApp inbound Meta webhooks are implemented at `POST /api/meta/webhook` with GET verification, HMAC signature checking, message/thread deduplication, deterministic qualification, and channel-specific action logs. Meta approval and live account testing remain required; no replies are sent.
- Persistent workspace/lead takeover controls block autonomous assignment. Qualified leads use the configured representative routing policy, but remain unassigned unless representative availability is explicitly verified.

Not configured or implemented:

- Tenant-level isolation and customer-data RLS policies. The current authorization model is for one workspace: any active linked sales representative can access the workspace. Do not use this model for multiple tenants.
- Gemini inquiry follow-up generation. Qualification calls Gemini only when `GEMINI_API_KEY` is configured server-side.
- Outgoing email.
- Verified per-representative availability for actual assignment, and Vercel deployment.

The Gmail, Calendar, Instagram, and WhatsApp integrations are not claimed live until each has been connected and manually verified. The test panel’s Analyze action does not save records or send messages; the separate Save action creates a real lead and requires the selected source channel to be accurate.

## Commands

```bash
npm run lint
npm test
npm run build
```

Edit the fictional Insight Analytics policy in `src/lib/policy-config.ts`. Its deterministic qualification and routing helpers live in `src/lib/policy.ts`; routing requires explicit representative availability input and does not assume that anyone is available.
