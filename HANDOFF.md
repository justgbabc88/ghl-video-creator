# Handoff — finishing the GHL Video Creator build

The agent's sandbox can't reach GitHub or Railway directly (proxy blocks them), so the last 3 deploy steps need to happen on your machine. Everything below is a copy-paste recipe. Total time: ~10 minutes.

## What's already done

- **Spec PDF** approved and saved to your Drive folder.
- **Supabase project `ghl-video-creator`** is live, schema applied, all 8 tables verified.
  - URL: `https://cddutihucarzapbibdii.supabase.co`
  - Anon key (legacy, JWT): `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkZHV0aWh1Y2FyemFwYmliZGlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0MzA2NTQsImV4cCI6MjA5MzAwNjY1NH0.ouE-nkn77zFjSlMh3ltjXEfDkrYrLDG5KlKhH_tQaeo`
  - Publishable key (recommended): `sb_publishable_6HLGLjAkZhwHdgpNkSp3RA_OVOuvxU8`
  - Project ref: `cddutihucarzapbibdii`
  - Region: `us-east-1`
- **Code** scaffolded in this repo (47 files, ~2,150 LOC). Monorepo with `packages/web` (Next.js) and `packages/worker` (Node + Playwright + ffmpeg).

## What I still need from the Supabase dashboard

Two things the MCP doesn't return — grab them once and paste into Railway + Vercel envs:

1. **Service role key** (Project Settings → API → "service_role" — keep secret).
2. **Database password** (Project Settings → Database). Build the connection string:
   `postgres://postgres:YOUR_PASSWORD@db.cddutihucarzapbibdii.supabase.co:5432/postgres`

## Step 1 — Push the code to GitHub

```bash
# In Terminal
cd ~/Downloads
tar -xzf ghl-video-creator.tar.gz
cd ghl-video-creator
git init && git add -A && git commit -m "Initial commit"

# Create the repo (use the GitHub web UI, then):
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ghl-video-creator.git
git push -u origin main
```

Or with `gh` CLI in one shot:

```bash
gh repo create ghl-video-creator --private --source=. --push
```

## Step 2 — Railway

1. Go to https://railway.app/new → "Deploy from GitHub repo" → pick `ghl-video-creator`.
2. Railway will detect the Dockerfile at `packages/worker/Dockerfile` (configured via `railway.toml`).
3. Under **Variables**, paste the env block from `RAILWAY_ENV.txt` (next file).
4. Click **Deploy**. First build takes ~5 min (Playwright base + ffmpeg).

You already have a Railway API token; you don't need to paste it anywhere — the dashboard handles auth for you. Keep it secret.

## Step 3 — Vercel

1. Go to https://vercel.com/new → import the same GitHub repo.
2. Set **Root Directory** to `packages/web`.
3. Framework preset: Next.js (auto-detected).
4. Under **Environment Variables**, paste the env block from `VERCEL_ENV.txt`.
5. Deploy.

## Step 4 — One-time post-deploy setup

1. Visit your Vercel URL → **Settings** → set your email, affiliate link, branding. Confirm "review queue ON" is checked (it is by default).
2. Click **Connect YouTube** → grant access. Refresh token will be stored in `accounts.youtube_refresh_token`.
3. (Optional) Visit **Settings → GHL** to upload session cookies for screen recording. Without this, the recorder still captures the changelog page narration but can't demo inside the GHL app.

## Step 5 — Tell me the URLs

Paste me back:
- GitHub repo URL
- Railway project URL
- Vercel deployment URL

I'll write the entry into your master Build Log Doc and flip the Sheet status to "Deployed" — that's Step 6 of your master prompt.

## Required API keys you need to create

| Service | Where | Notes |
|---|---|---|
| **Anthropic** | console.anthropic.com → API Keys | For Claude Sonnet 4.6 script generation. |
| **ElevenLabs** | elevenlabs.io → Profile → API Keys | For voice narration. Pick a plan ≥ Creator if you'll do >100k chars/mo. |
| **Google Cloud (YouTube)** | console.cloud.google.com → APIs & Services → Credentials. Enable "YouTube Data API v3". Create an **OAuth 2.0 Client ID** (Web app). | Authorized redirect URI: `https://YOUR_VERCEL_URL/api/youtube/oauth/callback` (and the localhost equivalent for local dev). |
| **Slack** (optional) | api.slack.com/apps → Incoming Webhooks | For status pings. |
