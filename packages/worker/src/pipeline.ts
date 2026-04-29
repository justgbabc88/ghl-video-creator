import {
  supabaseService,
  logEvent,
  env,
  type NotificationSettings,
  type Account,
} from "@ghl-vc/shared";
import { generateScript } from "./jobs/script.js";
import { recordWalkthrough } from "./jobs/record.js";
import { narrate } from "./jobs/narrate.js";
import { renderFinal } from "./jobs/render.js";
import { publishToYouTube, publishShorts } from "./jobs/publish.js";
import { crosspost } from "./jobs/crosspost.js";
import { notifySlack } from "./lib/slack.js";
import { sendAlertEmail } from "./lib/email.js";

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
    .select("id,account_id,title,url,raw_html,summary,use_cases,parent_feature_id")
    .eq("status", "new")
    .limit(3);

  for (const f of newFeatures ?? []) {
    try {
      await sb.from("features").update({ status: "scripting" }).eq("id", f.id);
      const scriptId = await generateScript(f as any);

      // If this feature regenerates a parent, link the new video to the previous one
      let supersedesVideoId: string | null = null;
      if ((f as any).parent_feature_id) {
        const { data: priorVideo } = await sb
          .from("videos")
          .select("id")
          .eq("feature_id", (f as any).parent_feature_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        supersedesVideoId = priorVideo?.id ?? null;
      }

      const { data: video } = await sb
        .from("videos")
        .insert({
          feature_id: f.id,
          script_id: scriptId,
          status: "queued",
          supersedes_video_id: supersedesVideoId,
        })
        .select("id")
        .single();

      // Roll the script's LLM cost into the video's budget
      if (video?.id) {
        const { chargeScriptCostToVideo } = await import("./jobs/script.js");
        await chargeScriptCostToVideo(scriptId, video.id);
      }

      await logEvent({
        videoId: video?.id,
        featureId: f.id,
        kind: "scripted",
        payload: { script_id: scriptId, supersedes_video_id: supersedesVideoId },
      });
    } catch (err) {
      await sb.from("features").update({ status: "new" }).eq("id", f.id);
      console.error("[pipeline] scripting failed for feature", f.id, err);
    }
  }

  // 2) Pick the oldest unfinished video and advance it one step.
  const { data: video } = await sb
    .from("videos")
    .select("id,status,feature_id,script_id,supersedes_video_id,cost_breakdown")
    .in("status", ["queued", "recording", "narrating", "rendering", "publishing"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!video) return;

  const { data: account } = (await sb.from("accounts").select("*").limit(1).maybeSingle()) as {
    data: Account | null;
  };
  if (!account) {
    console.warn("[pipeline] no account configured yet — visit /settings to create one.");
    return;
  }

  try {
    if (video.status === "queued" || video.status === "recording") {
      await advance(video.id, "recording");
      const recordingUrl = await recordWalkthrough(video.id, video.script_id, account);
      await sb.from("videos").update({ recording_url: recordingUrl }).eq("id", video.id);
      await advance(video.id, "narrating");
    } else if (video.status === "narrating") {
      const { mp3Url } = await narrate(video.id, video.script_id, account);
      await sb.from("videos").update({ narration_url: mp3Url }).eq("id", video.id);
      await advance(video.id, "rendering");
    } else if (video.status === "rendering") {
      const { finalUrl } = await renderFinal(video.id, account);
      await sb.from("videos").update({ final_url: finalUrl }).eq("id", video.id);
      const next = account.review_required ? "review" : "publishing";
      await advance(video.id, next);
      if (next === "review") {
        await notify(account, "review_ready", `📼 Video ready for review: ${video.id}`);
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
      await notify(account, "published", `✅ Published: ${result.url}`);

      // Best-effort post-publish steps. Failures here shouldn't undo a successful publish.
      try {
        const shorts = await publishShorts(video.id, account);
        if (shorts) {
          await logEvent({ videoId: video.id, kind: "shorts_published", payload: shorts });
        }
      } catch (err) {
        console.warn("[pipeline] shorts publish failed:", err);
      }

      try {
        await crosspost(video.id, account);
      } catch (err) {
        console.warn("[pipeline] crosspost failed:", err);
      }

      // If this video supersedes an older one, mark the older as superseded for clarity
      if (video.supersedes_video_id) {
        await sb
          .from("videos")
          .update({ status: "failed", error: "Superseded by newer version" })
          .eq("id", video.supersedes_video_id)
          .eq("status", "published"); // only flip if it was published; respect other states
      }
    }

    // Per-video budget check
    const { data: latest } = await sb
      .from("videos")
      .select("cost_breakdown")
      .eq("id", video.id)
      .maybeSingle();
    const total = (latest?.cost_breakdown as any)?.total ?? 0;
    if (total > env.PER_VIDEO_BUDGET_USD) {
      await fail(
        video.id,
        account,
        `Cost exceeded budget ($${total.toFixed(2)} > $${env.PER_VIDEO_BUDGET_USD})`,
      );
    }
  } catch (err) {
    await fail(video.id, account, err instanceof Error ? err.message : String(err));
  }
}

async function advance(videoId: string, status: string) {
  const sb = supabaseService();
  await sb.from("videos").update({ status }).eq("id", videoId);
  await logEvent({ videoId, kind: `enter_${status}` });
}

async function fail(videoId: string, account: Account, message: string) {
  const sb = supabaseService();
  await sb.from("videos").update({ status: "failed", error: message }).eq("id", videoId);
  await logEvent({ videoId, kind: "failed", payload: { message } });
  await notify(account, "failed", `❌ Video ${videoId} failed: ${message}`);
}

async function notify(
  account: Account,
  event: NonNullable<NotificationSettings["events"]>[number],
  message: string,
) {
  const settings = (account.notification_settings ?? {}) as NotificationSettings;
  const events = settings.events ?? ["review_ready", "published", "failed"];
  if (!events.includes(event)) return;
  if (settings.slack !== false) await notifySlack(message);
  if (settings.email && account.email) {
    await sendAlertEmail({
      to: account.email,
      subject: `[GHL Video Creator] ${event}`,
      body: message,
    });
  }
}
