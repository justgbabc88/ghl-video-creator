import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { supabaseService } from "@ghl-vc/shared";
import type { Account } from "@ghl-vc/shared";
import { ytClient, downloadToFile } from "../lib/youtube.js";

/**
 * Upload the final mp4 to YouTube via Data API v3 (1,600 quota units per upload).
 * Generates / reads a `publications` row for title/description/tags. Appends the
 * affiliate link + a YouTube-required disclosure to the description.
 */
export async function publishToYouTube(
  videoId: string,
  account: Account,
): Promise<{ id: string; url: string }> {
  const sb = supabaseService();

  const { data: video } = await sb
    .from("videos")
    .select("final_url,thumbnail_url,feature_id,scripts!inner(sections),features!inner(title)")
    .eq("id", videoId)
    .maybeSingle();
  if (!video?.final_url) throw new Error("Missing final_url");
  if (!account.youtube_refresh_token) {
    throw new Error("YouTube not connected — visit /settings/youtube");
  }

  let { data: pub } = await sb
    .from("publications")
    .select("title,description,tags,privacy_status")
    .eq("video_id", videoId)
    .maybeSingle();

  if (!pub) {
    const featureTitle = (video.features as any)?.title ?? "GHL update";
    pub = {
      title: `New in GoHighLevel: ${featureTitle}`.slice(0, 99),
      description: buildDescriptionFromSections((video.scripts as any)?.sections ?? []),
      tags: ["gohighlevel", "ghl", "saas", "marketing", "tutorial"],
      privacy_status: "public",
    };
    await sb.from("publications").insert({ video_id: videoId, ...pub });
  }

  const description = appendAffiliate(pub.description ?? "", account.affiliate_link);

  const tmpVideo = path.join(os.tmpdir(), `yt-${videoId}.mp4`);
  await downloadToFile(video.final_url, tmpVideo);

  const yt = ytClient(account.youtube_refresh_token);

  const insert = await yt.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: pub.title ?? "GHL Update",
        description,
        tags: pub.tags ?? undefined,
        categoryId: "28", // Science & Technology
      },
      status: {
        privacyStatus: (pub.privacy_status ?? "public") as "public" | "private" | "unlisted",
        selfDeclaredMadeForKids: false,
      },
    },
    media: { body: fs.createReadStream(tmpVideo) },
  });

  const id = insert.data.id;
  if (!id) throw new Error("YouTube did not return a video id");

  // Best-effort thumbnail upload
  if (video.thumbnail_url) {
    try {
      const tmpThumb = path.join(os.tmpdir(), `yt-${videoId}.jpg`);
      await downloadToFile(video.thumbnail_url, tmpThumb);
      await yt.thumbnails.set({
        videoId: id,
        media: { body: fs.createReadStream(tmpThumb) },
      });
      fs.unlinkSync(tmpThumb);
    } catch (err) {
      console.warn("[publish] thumbnail upload failed:", err);
    }
  }

  fs.unlinkSync(tmpVideo);

  return { id, url: `https://www.youtube.com/watch?v=${id}` };
}

function buildDescriptionFromSections(sections: any[]): string {
  if (!sections?.length) return "";
  const intro =
    "In this video I walk through the latest GoHighLevel feature — what it does, how to use it, and a few real use cases.\n\n";
  const chapters = sections
    .reduce(
      (acc, s, i) => {
        const prevEnd = i === 0 ? 0 : acc.cum;
        const ts = formatTimestamp(prevEnd);
        acc.lines.push(`${ts} ${s.title}`);
        acc.cum = prevEnd + (s.approx_seconds ?? 30);
        return acc;
      },
      { lines: [] as string[], cum: 0 },
    )
    .lines.join("\n");

  return `${intro}Chapters:\n${chapters}\n\n— Built automatically with the GHL Video Creator agent.`;
}

function formatTimestamp(s: number) {
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function appendAffiliate(desc: string, affiliate: string | null) {
  const disclosure = "\n\n📢 This video may contain affiliate links — I earn a small commission if you sign up.";
  if (!affiliate) return desc + disclosure;
  return desc.replace("{{AFFILIATE}}", affiliate) + `\n\n👉 Try GoHighLevel: ${affiliate}` + disclosure;
}
