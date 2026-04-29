# GHL Video Creator & Publisher

Detects new GoHighLevel features, generates a screen-recorded walkthrough with AI voiceover, and publishes to YouTube. See `GHL_Video_Creator_Spec.pdf` (in the approval Drive folder) for the full design.

## Repo layout

```
packages/
  shared/   # types + Supabase client used by web and worker
  web/      # Next.js dashboard (Vercel)
  worker/   # Node service: cron + Playwright + ffmpeg + YouTube upload (Railway)
supabase/
  migrations/0001_init.sql
```

## Pipeline

```
detect (cron) -> script (Claude) -> record (Playwright) -> narrate (ElevenLabs) -> render (ffmpeg) -> review queue -> publish (YouTube)
```

Each stage writes to Postgres (`videos.status`) and emits a row in `events`. Failures stop the pipeline at that stage and surface in the dashboard + Slack.

## Local dev

```bash
npm install
cp .env.example .env       # fill in keys
npm run dev:web            # dashboard at http://localhost:3000
npm run dev:worker         # worker loop in a second terminal
```

## Deploy

Vercel connects to `packages/web` (root directory) with the standard Next.js build. Railway runs the worker via the included Dockerfile (Playwright + ffmpeg preinstalled).

Required env vars are listed in `.env.example`.

## Manual setup steps after first deploy

1. **YouTube OAuth.** Visit `/settings/youtube` on the dashboard, click "Connect YouTube", grant access. The app stores your refresh token in `accounts.youtube_refresh_token`.
2. **GHL session.** Visit `/settings/ghl`, paste cookies from a logged-in GHL session (or use email/password — the worker logs in once and stores cookies). Stored encrypted in `accounts`.
3. **Affiliate link & branding.** Set on `/settings/branding`: affiliate URL, logo, intro/outro mp4 (optional).
4. **Voice.** Default is Rachel (`21m00Tcm4TlvDq8ikWAM`). Change on `/settings/voice` — pick from your ElevenLabs library.
5. **Review queue.** ON by default; flip to OFF on `/settings` once you trust the output.

## YouTube quota note

Default Data API v3 quota is 10,000 units/day; an upload costs 1,600 — that's 6 uploads/day. Plenty for GHL's release cadence, but apply for a quota increase if you need more.
