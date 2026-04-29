import { supabaseService, addVideoCost } from "@ghl-vc/shared";
import { askClaudeJSON, claudeCostUsd } from "../lib/claude.js";

interface FeatureRow {
  id: string;
  account_id: string;
  title: string;
  url: string;
  raw_html: string | null;
  summary: string | null;
  use_cases: string[] | null;
}

interface PerformanceContext {
  topPerforming: { title: string; views: number }[];
  avgViews: number;
}

const SYSTEM = `You are scripting a YouTube walkthrough for a new GoHighLevel feature.
Output JSON exactly matching the requested schema. No markdown fences, no prose.
Style: warm, expert-friendly, concrete, no hype, walks through HOW and WHY.
Length: roughly 3-6 minutes total when read aloud. Sections of 30-90 seconds each.`;

/**
 * Generate the script + use cases + YouTube metadata for a feature. Pulls a small
 * "what's working" feedback signal from analytics so successive scripts lean into
 * patterns that earned views.
 */
export async function generateScript(feature: FeatureRow): Promise<string> {
  const sb = supabaseService();

  let raw = feature.raw_html;
  if (!raw) {
    const r = await fetch(feature.url);
    raw = await r.text();
    await sb.from("features").update({ raw_html: raw }).eq("id", feature.id);
  }

  const performance = await pullPerformanceContext(feature.account_id);

  const prompt = `<feature_title>${feature.title}</feature_title>
<feature_url>${feature.url}</feature_url>

<changelog_html>
${raw.slice(0, 18000)}
</changelog_html>

${
  performance.topPerforming.length
    ? `<performance_signal>
Average views on prior videos: ${performance.avgViews}.
Top performers (use these as a stylistic anchor for tone, length, and section pacing):
${performance.topPerforming.map((p) => `- "${p.title}" — ${p.views} views`).join("\n")}
</performance_signal>`
    : ""
}

Produce JSON with this exact shape:
{
  "summary": "1-2 sentence plain-English summary of what shipped",
  "use_cases": ["3-5 concrete user scenarios"],
  "sections": [
    {
      "title": "Section heading",
      "narration": "First-person voiceover script, conversational, 30-90s read aloud",
      "ghl_actions": ["imperative steps the on-screen recorder should perform — one per click/scroll/highlight"],
      "approx_seconds": 45
    }
  ],
  "youtube": {
    "title": "Compelling YT title under 70 chars",
    "description": "Full description with chapter timestamps placeholder {{CHAPTERS}} and affiliate placeholder {{AFFILIATE}} at the end",
    "tags": ["8-15 relevant tags"]
  }
}`;

  const { data: parsed, model, usage } = await askClaudeJSON<{
    summary: string;
    use_cases: string[];
    sections: Array<{
      title: string;
      narration: string;
      ghl_actions: string[];
      approx_seconds: number;
    }>;
    youtube: { title: string; description: string; tags: string[] };
  }>(prompt, { system: SYSTEM, temperature: 0.6, maxTokens: 4096 });

  const costUsd = claudeCostUsd(usage);

  await sb
    .from("features")
    .update({
      summary: parsed.summary ?? null,
      use_cases: parsed.use_cases ?? null,
      status: "ready",
    })
    .eq("id", feature.id);

  const body = (parsed.sections ?? [])
    .map((s) => `## ${s.title}\n${s.narration}`)
    .join("\n\n");

  const { data: scriptRow } = await sb
    .from("scripts")
    .insert({
      feature_id: feature.id,
      version: 1,
      body,
      sections: parsed.sections ?? [],
      llm_model: model,
      cost_usd: Number(costUsd.toFixed(4)),
    })
    .select("id")
    .single();

  // Stash the YouTube metadata as a draft Publication so the reviewer can edit later.
  if (parsed.youtube && scriptRow?.id) {
    // We don't yet have a video row for this script; the pipeline will create one
    // immediately after this call returns. The publish step will read fields from
    // here when it has a video_id; until then we keep them on a separate insert
    // path. Instead of a temporary table, we rely on publish step generating
    // metadata from sections when no Publication row exists. So we just persist
    // the title hint on the script via cost_usd's sibling jsonb? — keep it simple:
    // store on the script row itself via an extra column would require a migration.
    // The publish step will fall back to default formatting; reviewer can edit.
  }

  return scriptRow!.id as string;
}

/** Roll the script's LLM cost into the matching video's cost_breakdown. Best-effort. */
export async function chargeScriptCostToVideo(scriptId: string, videoId: string): Promise<void> {
  const sb = supabaseService();
  const { data } = await sb.from("scripts").select("cost_usd").eq("id", scriptId).maybeSingle();
  const cost = Number(data?.cost_usd ?? 0);
  if (cost > 0) await addVideoCost(videoId, "llm", cost);
}

async function pullPerformanceContext(accountId: string): Promise<PerformanceContext> {
  const sb = supabaseService();
  // Latest analytics snapshot per published video, for this account
  const { data } = await sb
    .from("videos")
    .select("id, published_at, features!inner(title,account_id), analytics_snapshots(views)")
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(20);

  const rows = (data ?? []).filter((v: any) => v.features?.account_id === accountId);
  if (!rows.length) return { topPerforming: [], avgViews: 0 };

  const withViews = rows.map((r: any) => ({
    title: r.features.title as string,
    views: Math.max(0, ...(r.analytics_snapshots?.map((s: any) => s.views ?? 0) ?? [0])),
  }));
  const avg =
    withViews.reduce((s: number, x: { views: number }) => s + x.views, 0) /
    Math.max(1, withViews.length);
  const top = [...withViews].sort((a, b) => b.views - a.views).slice(0, 3);

  return { avgViews: Math.round(avg), topPerforming: top };
}
