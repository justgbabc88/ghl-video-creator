import { supabaseService, logEvent, env } from "@ghl-vc/shared";
import { generateScript } from "./jobs/script.js";
import { recordWalkthrough } from "./jobs/record.js";
import { narrate } from "./jobs/narrate.js";
import { renderFinal } from "./jobs/render.js";
import { publishToYouTube } from "./jobs/publish.js";
import { notifySlack } from "./lib/slack.js";

/**
 * State machine driver. Each tick advances at most one video by one stage so a
 * single bad item can't starve the rest of the queue.
 *
 *   queued -> recording -> narrating -> rendering -> review -> publishing -> published
 *                                                ^ skipped if account.review_required = false
 */
export async function runPipeline(): Promise<void> {
  const sb = supabaseService();

  // 1) For every feature with status='new', kick off a video row + script generation.
  const { data: newFeatures } = await sb
    .from("features")
    .select("id,account_id,title,url,raw_html,summary,use_cases")
    .eq("status", "new")
    .limit(3); // small batch per tick

  for (const f of newFeatures ?? []) {
    try {
      await sb.from("features").update({ status: "scripting" }).eq("id", f.id);
      const scriptId = await generateScript(f as any);
      const { data: video } = await sb
        .from("videos")
        .insert({ feature_id: f.id, script_id: scriptId, status: "queued" })
        .select("id")
        .single();
      await logEvent({
        videoId: video?.id,
        featureId: f.id,
        kind: "scripted",
        payload: { script_id: scriptId },
      });
    } catch (err) {
      await sb.from("features").update({ status: "new" }).eq("id", f.id); // unlock for retry
      console.error("[pipeline] scripting failed for feature", f.id, err);
    }
  }

  // 2) Pick the oldest unfinished video and advance it one step.
  const { data: video } = await sb
    .from("videos")
    .select("id,status,feature_id,script_id,cost_breakdown")
    .in("status", ["queued", "recording", "narrating", "rendering", "publishing"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!video) return;

  const { data: account } = await sb.from("accounts").select("*").limit(1).maybeSingle();
  if (!account) {
    console.warn("[pipeline] no account configured yet — visit /settings to create one.");
    return;
  }

  try {
    if (video.status === "queued") {
      await advance(video.id, "recording");
      const recordingUrl = await recordWalkthrough(video.id, video.script_id, account);
      await sb.from("videos").update({ recording_url: recordingUrl }).eq("id", video.id);
      await advance(video.id, "narrating");
    } else if (video.status === "recording") {
      // crash recovery: re-attempt this stage
      const recordingUrl = await recordWalkthrough(video.id, video.script_id, account);
      await sb.from("videos").update({ recording_url: recordingUrl }).eq("id", video.id);
      await advance(video.id, "narrating");
    } else if (video.status === "narrating") {
      const narrationUrl = await narrate(video.id, video.script_id, account);
      await sb.from("videos").update({ narration_url: narrationUrl }).eq("id", video.id);
      await advance(video.id, "rendering");
    } else if (video.status === "rendering") {
      const finalUrl = await renderFinal(video.id, account);
      await sb.from("videos").update({ final_url: finalUrl }).eq("id", video.id);
      const next = account.review_required ? "review" : "publishing";
      await advance(video.id, next);
      if (next === "review") {
        await notifySlack(`📼 Video ready for review: ${video.id}`);
      }
    } else if (video.status === "publishing") {
      const result = await publishToYouTube(video.id, account);
      await sb
        .from("videos")
        .update({
          youtube_video_id: result.id,
          youtube_url: result.url,
          status: "published",
          published_at: new Date().toISOString(),
        })
        .eq("id", video.id);
      await logEvent({ videoId: video.id, kind: "published", payload: result });
      await notifySlack(`✅ Published: ${result.url}`);
    }

    // Per-video budget check
    const { data: latest } = await sb
      .from("videos")
      .select("cost_breakdown")
      .eq("id", video.id)
      .maybeSingle();
    const total = (latest?.cost_breakdown as any)?.total ?? 0;
    if (total > env.PER_VIDEO_BUDGET_USD) {
      await fail(video.id, `Cost exceeded budget ($${total.toFixed(2)} > $${env.PER_VIDEO_BUDGET_USD})`);
    }
  } catch (err) {
    await fail(video.id, err instanceof Error ? err.message : String(err));
  }
}

async function advance(videoId: string, status: string) {
  const sb = supabaseService();
  await sb.from("videos").update({ status }).eq("id", videoId);
  await logEvent({ videoId, kind: `enter_${status}` });
}

async function fail(videoId: string, message: string) {
  const sb = supabaseService();
  await sb.from("videos").update({ status: "failed", error: message }).eq("id", videoId);
  await logEvent({ videoId, kind: "failed", payload: { message } });
  await notifySlack(`❌ Video ${videoId} failed: ${message}`);
}
