-- Pause toggle for the worker. When true, both the detect cron and the pipeline
-- cron skip their tick — no new feature rows are inserted, no in-flight videos
-- advance through stages.
alter table accounts add column if not exists pipeline_paused boolean not null default false;
