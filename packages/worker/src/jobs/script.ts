import { supabaseService } from "@ghl-vc/shared";
import { askClaude } from "../lib/claude.js";

interface FeatureRow {
  id: string;
  account_id: string;
  title: string;
  url: string;
  raw_html: string | null;
  summary: string | null;
  use_cases: string[] | null;
}

/**
 * Fetch the changelog page if we don't already have HTML, then ask Claude to produce:
 *   - a short summary
 *   - 3-5 use cases
 *   - a sectioned narration script with imperative GHL actions
 *   - YouTube metadata (title, description, tags, chapter timestamps)
 *
 * Persists a `scripts` row + a draft `publications` row, returns the script id.
 */
export async function generateScript(feature: FeatureRow): Promise<string> {
  const sb = supabaseService();

  let raw = feature.raw_html;
  if (!raw) {
    const r = await fetch(feature.url);
    raw = await r.text();
    await sb.from("features").update({ raw_html: raw }).eq("id", feature.id);
  }

  const prompt = `You are scripting a YouTube walkthrough for a new GoHighLevel feature.

<feature_title>${feature.title}</feature_title>
<feature_url>${feature.url}</feature_url>
<changelog_html>
${raw.slice(0, 18000)}
</changelog_html>

Produce JSON with the following shape (no extra prose, no markdown fences):
{
  "summary": "1-2 sentence plain-English summary of what shipped",
  "use_cases": ["3-5 concrete user scenarios"],
  "sections": [
    {
      "title": "Section heading",
      "narration": "First-person voiceover script, conversational, ~30-90s read aloud",
      "ghl_actions": ["imperative steps for the on-screen recorder, e.g. 'Click Settings > Integrations'"],
      "approx_seconds": 45
    }
  ],
  "youtube": {
    "title": "Compelling YT title under 70 chars",
    "description": "Full description with chapter timestamps from the sections, ending with the affiliate CTA placeholder {{AFFILIATE}}",
    "tags": ["8-15 relevant tags"]
  }
}

Style: warm, expert-friendly, no hype, walks through HOW and WHY. Length total ~3-6 minutes.`;

  const { text, usage, model } = await askClaude(prompt, { temperature: 0.6, maxTokens: 4096 });

  // Strip code fences if Claude added them despite instructions
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  const parsed = JSON.parse(cleaned);

  // Cost: Sonnet 4.6 = $3/$15 per 1M
  const costUsd = (usage.input_tokens * 3 + usage.output_tokens * 15) / 1_000_000;

  await sb
    .from("features")
    .update({
      summary: parsed.summary ?? null,
      use_cases: parsed.use_cases ?? null,
      status: "ready",
    })
    .eq("id", feature.id);

  const body = (parsed.sections ?? [])
    .map((s: any) => `## ${s.title}\n${s.narration}`)
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

  return scriptRow!.id as string;
}
