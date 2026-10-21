create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type public.lead_channel as enum ('instagram', 'whatsapp', 'email');
create type public.lead_status as enum (
  'new',
  'qualifying',
  'qualified',
  'follow_up',
  'meeting_booked',
  'disqualified'
);
create type public.message_direction as enum ('inbound', 'outbound');
create type public.meeting_status as enum (
  'pending_confirmation',
  'confirmed',
  'cancelled'
);

create table public.sales_representatives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  display_name text not null check (length(trim(display_name)) > 0),
  email text not null unique check (length(trim(email)) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  email text,
  company text,
  channel public.lead_channel not null,
  status public.lead_status not null default 'new',
  assigned_representative_id uuid references public.sales_representatives(id) on delete set null,
  qualification_evidence jsonb not null default '{}'::jsonb,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  channel public.lead_channel not null,
  direction public.message_direction not null,
  body text not null,
  provider_message_id text,
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (channel, provider_message_id)
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  representative_id uuid references public.sales_representatives(id) on delete set null,
  status public.meeting_status not null default 'pending_confirmation',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  customer_confirmed_at timestamptz,
  external_event_id text unique,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (status <> 'confirmed' or customer_confirmed_at is not null),
  check (
    status <> 'pending_confirmation'
    or customer_confirmed_at is null
  ),
  exclude using gist (
    representative_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'confirmed' and representative_id is not null)
);

create table public.action_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action_type text not null check (length(trim(action_type)) > 0),
  summary text not null check (length(trim(summary)) > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.automation_controls (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  channel public.lead_channel,
  is_enabled boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (lead_id is not null or channel is not null),
  unique nulls not distinct (lead_id, channel)
);

create index leads_status_last_activity_idx on public.leads(status, last_activity_at desc);
create index leads_assigned_representative_idx on public.leads(assigned_representative_id);
create index leads_channel_created_at_idx on public.leads(channel, created_at desc);
create index messages_lead_sent_at_idx on public.messages(lead_id, sent_at desc);
create index meetings_lead_status_idx on public.meetings(lead_id, status);
create index meetings_representative_start_idx on public.meetings(representative_id, starts_at);
create index action_logs_lead_created_at_idx on public.action_logs(lead_id, created_at desc);
create index automation_controls_lead_channel_idx on public.automation_controls(lead_id, channel);

alter table public.sales_representatives enable row level security;
alter table public.leads enable row level security;
alter table public.messages enable row level security;
alter table public.meetings enable row level security;
alter table public.action_logs enable row level security;
alter table public.automation_controls enable row level security;

-- No client policies are granted by default. Add authenticated, organization-scoped
-- policies only after the application's tenant and role model is established.
