import { supabaseService } from "@ghl-vc/shared";
import { ytClient } from "../lib/youtube.js";

/**
 * Pull yesterday's stats for every published video and snapshot to analytics_snapshots.
 * Also feed back into the LLM context next time a script is generated, so we lean
 * into what's working.
 */
export async function pullAnalytics(): Promise<void> {
  const sb = supabaseService();
  const { data: account } = await sb.from("accounts").select("youtube_refresh_token").limit(1).maybeSingle();
  if (!account?.youtube_refresh_token) return;

  const { data: videos } = await sb
    .from("videos")
    .select("id,youtube_video_id")
    .eq("status", "published")
    .not("youtube_video_id", "is", null)
    .limit(100);

  if (!videos?.length) return;
  const yt = ytClient(account.youtube_refresh_token);

  for (const v of videos) {
    if (!v.youtube_video_id) continue;
    try {
      const r = await yt.videos.list({
        part: ["statistics"],
        id: [v.youtube_video_id],
      });
      const stats = r.data.items?.[0]?.statistics;
      if (!stats) continue;
      await sb.from("analytics_snapshots").insert({
        video_id: v.id,
        views: parseInt(stats.viewCount ?? "0", 10),
        watch_time_minutes: null, // requires YouTube Analytics API for accurate value
        ctr: null,
        subs_gained: null,
      });
    } catch (err) {
      console.warn("[analytics] skip", v.id, err);
    }
  }
}
