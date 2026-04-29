import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { supabaseService } from "@ghl-vc/shared";
import type { Account } from "@ghl-vc/shared";
import { uploadToStorage, downloadFromUrl } from "../lib/supabase.js";
import { muxAudioVideo, makeThumbnail } from "../lib/ffmpeg.js";

/**
 * Combine the screen recording (.webm) with the narration (.mp3), prepend brand intro
 * and append outro if the account has them, and write the final mp4 + a thumbnail.
 */
export async function renderFinal(videoId: string, account: Account): Promise<string> {
  const sb = supabaseService();
  const { data: video } = await sb
    .from("videos")
    .select("recording_url,narration_url,feature_id,features!inner(title)")
    .eq("id", videoId)
    .maybeSingle();
  if (!video?.recording_url || !video?.narration_url) {
    throw new Error("Missing recording_url or narration_url");
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `ghl-render-${videoId}-`));
  const recPath = path.join(tmpDir, "recording.webm");
  const narrPath = path.join(tmpDir, "narration.mp3");
  const finalPath = path.join(tmpDir, "final.mp4");
  const thumbPath = path.join(tmpDir, "thumb.jpg");

  await Promise.all([
    downloadFromUrl(video.recording_url, recPath),
    downloadFromUrl(video.narration_url, narrPath),
  ]);

  const intro = account.brand_intro_url
    ? await downloadCached(account.brand_intro_url, path.join(tmpDir, "intro.mp4"))
    : null;
  const outro = account.brand_outro_url
    ? await downloadCached(account.brand_outro_url, path.join(tmpDir, "outro.mp4"))
    : null;

  await muxAudioVideo({
    video: recPath,
    audio: narrPath,
    intro,
    outro,
    output: finalPath,
  });

  const featureTitle = (video.features as any)?.title ?? "GHL Update";
  await makeThumbnail({ source: finalPath, output: thumbPath, label: featureTitle });

  const [finalBuf, thumbBuf] = await Promise.all([
    fs.readFile(finalPath),
    fs.readFile(thumbPath),
  ]);
  const [finalUrl, thumbUrl] = await Promise.all([
    uploadToStorage(`videos/${videoId}.mp4`, finalBuf, "video/mp4"),
    uploadToStorage(`thumbnails/${videoId}.jpg`, thumbBuf, "image/jpeg"),
  ]);

  await sb.from("videos").update({ thumbnail_url: thumbUrl }).eq("id", videoId);
  await fs.rm(tmpDir, { recursive: true, force: true });
  return finalUrl;
}

async function downloadCached(url: string, dest: string): Promise<string> {
  await downloadFromUrl(url, dest);
  return dest;
}
