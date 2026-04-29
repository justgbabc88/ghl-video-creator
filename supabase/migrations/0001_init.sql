-- GHL Video Creator & Publisher — initial schema
-- Mirrors section 6 of the build spec. Idempotent (uses IF NOT EXISTS).

create extension if not exists "pgcrypto";

-- A user / channel that owns the automation. Single-row in MVP, but multi-account ready.
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  youtube_channel_id text,
  youtube_refresh_token text,
  affiliate_link text,
  default_voice_id text default '21m00Tcm4TlvDq8ikWAM',  -- ElevenLabs Rachel
  brand_intro_url text,
  brand_outro_url text,
  brand_logo_url text,
  ghl_session_cookies jsonb,                              -- encrypted at app layer
  review_required boolean not null default true,
  created_at timestamptz not null default now()
);

-- Features detected from GHL changelog
create table if not exists features (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  source text not null,
  source_id text not null,
  title text not null,
  url text not null,
  raw_html text,
  summary text,
  use_cases jsonb,
  detected_at timestamptz not null default now(),
  status text not null default 'new',
  unique (account_id, source, source_id)
);

create index if not exists features_account_status_idx on features (account_id, status);

-- Generated narration script for a feature
create table if not exists scripts (
  id uuid primary key default gen_random_uuid(),
  feature_id uuid not null references features(id) on delete cascade,
  version int not null default 1,
  body text not null,
  sections jsonb,
  llm_model text,
  cost_usd numeric(10, 4),
  created_at timestamptz not null default now()
);

-- Render jobs (one per video produced)
create table if not exists videos (
  id uuid primary key default gen_random_uuid(),
  feature_id uuid not null references features(id) on delete cascade,
  script_id uuid references scripts(id) on delete set null,
  status text not null default 'queued',
  recording_url text,
  narration_url text,
  final_url text,
  thumbnail_url text,
  youtube_video_id text,
  youtube_url text,
  duration_seconds int,
  cost_breakdown jsonb,
  error text,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create index if not exists videos_feature_idx on videos (feature_id);
create index if not exists videos_status_idx on videos (status);

-- YouTube metadata draft / final
create table if not exists publications (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos(id) on delete cascade,
  title text,
  description text,
  tags text[],
  category_id int default 28,                             -- Science & Technology
  privacy_status text default 'public',
  scheduled_for timestamptz,
  approved_by text,
  approved_at timestamptz
);

-- Append-only event log per video
create table if not exists events (
  id bigserial primary key,
  video_id uuid references videos(id) on delete cascade,
  feature_id uuid references features(id) on delete cascade,
  kind text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_video_idx on events (video_id, created_at);

-- Per-account skip rules (regex on title or category)
create table if not exists skip_rules (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  pattern text not null,
  reason text,
  created_at timestamptz not null default now()
);

-- YouTube performance pulled back in
create table if not exists analytics_snapshots (
  id bigserial primary key,
  video_id uuid not null references videos(id) on delete cascade,
  views int,
  watch_time_minutes int,
  ctr numeric(5, 4),
  subs_gained int,
  pulled_at timestamptz not null default now()
);

-- RLS off for MVP (single user, service role only). Enable + add policies before opening to multiple users.
alter table accounts disable row level security;
alter table features disable row level security;
alter table scripts disable row level security;
alter table videos disable row level security;
alter table publications disable row level security;
alter table events disable row level security;
alter table skip_rules disable row level security;
alter table analytics_snapshots disable row level security;
