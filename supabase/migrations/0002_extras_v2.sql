-- v2 additions: voice presets, notification settings, captions, shorts, versioned regen, content-hash dedup, crossposts
-- Idempotent — safe to re-run.

alter table accounts add column if not exists voice_presets jsonb default '[]'::jsonb;
alter table accounts add column if not exists notification_settings jsonb default '{"slack": true, "email": false}'::jsonb;

alter table videos add column if not exists shorts_url text;
alter table videos add column if not exists shorts_youtube_video_id text;
alter table videos add column if not exists shorts_youtube_url text;
alter table videos add column if not exists captions_url text;
alter table videos add column if not exists narration_segments jsonb;
alter table videos add column if not exists supersedes_video_id uuid references videos(id) on delete set null;

alter table features add column if not exists parent_feature_id uuid references features(id) on delete set null;
alter table features add column if not exists content_hash text;
alter table features add column if not exists version int not null default 1;

create index if not exists features_content_hash_idx on features (account_id, content_hash);
create index if not exists features_parent_idx on features (parent_feature_id);
create index if not exists videos_supersedes_idx on videos (supersedes_video_id);

-- Cross-post log
create table if not exists crossposts (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos(id) on delete cascade,
  channel text not null,
  external_id text,
  external_url text,
  status text not null default 'queued',
  error text,
  created_at timestamptz not null default now()
);
create index if not exists crossposts_video_idx on crossposts (video_id);

alter table crossposts disable row level security;
