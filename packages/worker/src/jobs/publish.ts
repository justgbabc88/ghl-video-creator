import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  supabaseService,
  type Account,
  type NarrationSegment,
} from "@ghl-vc/shared";
import { ytClient, downloadToFile } from "../lib/youtube.js";

/**
 * Upload to YouTube. Reads metadata from `publications` (so reviewer edits are honored)
 * and falls back to defaults if no row exists. Uploads thumbnail + captions if available.
 */
export async function publishToYouTube(
  videoId: string,
  account: Account,
): Promise<{ id: string; url: string }> {
  const sb = supabaseService();

  const { data: video } = await sb
    .from("videos")
    .select(
      "final_url,thumbnail_url,captions_url,narration_segments,feature_id,scripts!inner(sections),features!inner(title)",
    )
    .eq("id", videoId)
    .maybeSingle();
  if (!video?.final_url) throw new Error("Missing final_url");
  if (!account.youtube_refresh_token) {
    throw new Error("YouTube not connected — visit /settings");
  }

  // Upsert a publications row with sane defaults if missing; otherwise honor what's there.
  let { data: pub } = await sb
    .from("publications")
    .select("title,description,tags,privacy_status")
    .eq("video_id", videoId)
    .maybeSingle();

  if (!pub) {
    const featureTitle = (video.features as any)?.title ?? "GHL update";
    const sections = ((video.scripts as any)?.sections ?? []) as Array<{ title: string }>;
    const segments = (video.narration_segments ?? []) as NarrationSegment[];
    pub = {
      title: `New in GoHighLevel: ${featureTitle}`.slice(0, 99),
      description: buildDescription(sections, segments, account),
      tags: ["gohighlevel", "ghl", "saas", "marketing", "tutorial"],
      privacy_status: "public",
    };
    await sb.from("publications").insert({ video_id: videoId, ...pub });
  } else {
    // The reviewer may have left {{CHAPTERS}} / {{AFFILIATE}} placeholders untouched — substitute now
    pub.description = substitutePlaceholders(
      pub.description ?? "",
      ((video.scripts as any)?.sections ?? []) as Array<{ title: string }>,
      (video.narration_segments ?? []) as NarrationSegment[],
      account,
    );
  }

  const tmpVideo = path.join(os.tmpdir(), `yt-${videoId}.mp4`);
  await downloadToFile(video.final_url, tmpVideo);

  const yt = ytClient(account.youtube_refresh_token);

  const insert = await yt.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: pub.title ?? "GHL Update",
        description: pub.description ?? "",
        tags: pub.tags ?? undefined,
        categoryId: "28",
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

  // Thumbnail
  if (video.thumbnail_url) {
    try {
      const tmpThumb = path.join(os.tmpdir(), `yt-${videoId}.jpg`);
      await downloadToFile(video.thumbnail_url, tmpThumb);
      await yt.thumbnails.set({ videoId: id, media: { body: fs.createReadStream(tmpThumb) } });
      fs.unlinkSync(tmpThumb);
    } catch (err) {
      console.warn("[publish] thumbnail upload failed:", err);
    }
  }

  // Captions
  if (video.captions_url) {
    try {
      const tmpSrt = path.join(os.tmpdir(), `yt-${videoId}.srt`);
      await downloadToFile(video.captions_url, tmpSrt);
      await yt.captions.insert({
        part: ["snippet"],
        requestBody: {
          snippet: { videoId: id, language: "en", name: "English" },
        },
        media: { body: fs.createReadStream(tmpSrt) },
      } as any);
      fs.unlinkSync(tmpSrt);
    } catch (err) {
      console.warn("[publish] captions upload failed:", err);
    }
  }

  fs.unlinkSync(tmpVideo);
  return { id, url: `https://www.youtube.com/watch?v=${id}` };
}

/** Upload the Shorts-format mp4 as its own YouTube video. */
export async function publishShorts(
  videoId: string,
  account: Account,
): Promise<{ id: string; url: string } | null> {
  const sb = supabaseService();
  const { data: video } = await sb
    .from("videos")
    .select("shorts_url,thumbnail_url,features!inner(title)")
    .eq("id", videoId)
    .maybeSingle();
  if (!video?.shorts_url) return null;
  if (!account.youtube_refresh_token) return null;

  const featureTitle = (video.features as any)?.title ?? "GHL update";
  const tmp = path.join(os.tmpdir(), `yt-${videoId}-shorts.mp4`);
  await downloadToFile(video.shorts_url, tmp);

  const yt = ytClient(account.youtube_refresh_token);
  const insert = await yt.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: `${featureTitle} #Shorts`.slice(0, 99),
        description: `Quick look at the new ${featureTitle} feature in GoHighLevel.\n\n${
          account.affiliate_link ? `Try GoHighLevel: ${account.affiliate_link}\n\n` : ""
        }#Shorts #GoHighLevel #GHL`,
        tags: ["gohighlevel", "ghl", "shorts", "saas"],
        categoryId: "28",
      },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
    },
    media: { body: fs.createReadStream(tmp) },
  });
  fs.unlinkSync(tmp);

  const id = insert.data.id;
  if (!id) return null;
  const url = `https://www.youtube.com/shorts/${id}`;
  await sb
    .from("videos")
    .update({ shorts_youtube_video_id: id, shorts_youtube_url: url })
    .eq("id", videoId);
  return { id, url };
}

function buildDescription(
  sections: { title: string }[],
  segments: NarrationSegment[],
  account: Account,
): string {
  const intro =
    "In this video I walk through the latest GoHighLevel feature — what it does, how to use it, and a few real use cases.\n\n";
  const chapters = chaptersFromSegments(sections, segments);
  return `${intro}Chapters:\n${chapters}${affiliateBlock(account)}\n— Built automatically with the GHL Video Creator agent.`;
}

function chaptersFromSegments(
  sections: { title: string }[],
  segments: NarrationSegment[],
): string {
  // YouTube requires the first chapter at 0:00 and at least 3 chapters
  if (!segments.length) {
    return sections
      .map((s, i) => `${formatTimestamp(i * 30)} ${s.title}`)
      .join("\n");
  }
  return segments
    .map((seg, i) => {
      const title = sections[seg.section_index]?.title ?? `Section ${i + 1}`;
      return `${formatTimestamp(seg.start_seconds)} ${title}`;
    })
    .join("\n");
}

function formatTimestamp(s: number) {
  const total = Math.max(0, Math.floor(s));
  const mm = Math.floor(total / 60).toString().padStart(2, "0");
  const ss = (total % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function substitutePlaceholders(
  desc: string,
  sections: { title: string }[],
  segments: NarrationSegment[],
  account: Account,
): string {
  return desc
    .replace("{{CHAPTERS}}", chaptersFromSegments(sections, segments))
    .replace("{{AFFILIATE}}", account.affiliate_link ?? "")
    .replace(/\n{3,}/g, "\n\n") +
    affiliateBlock(account);
}

function affiliateBlock(account: Account): string {
  const disclosure =
    "\n\n📢 This video may contain affiliate links — I earn a small commission if you sign up.";
  if (!account.affiliate_link) return disclosure;
  return `\n\n👉 Try GoHighLevel: ${account.affiliate_link}${disclosure}`;
}
