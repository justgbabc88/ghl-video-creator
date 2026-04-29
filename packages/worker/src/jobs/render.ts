import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import {
  supabaseService,
  addVideoCost,
  type Account,
  type NarrationSegment,
  type ScriptSection,
} from "@ghl-vc/shared";
import { uploadToStorage, downloadFromUrl } from "../lib/supabase.js";
import { muxAudioVideo, makeThumbnail, makeShortsCut } from "../lib/ffmpeg.js";

/**
 * Combine recording + narration with watermark + lower-thirds, prepend brand intro,
 * append outro, generate thumbnail, and produce a Shorts cut.
 */
export async function renderFinal(
  videoId: string,
  account: Account,
): Promise<{ finalUrl: string; shortsUrl: string | null }> {
  const sb = supabaseService();
  const { data: video } = await sb
    .from("videos")
    .select(
      "recording_url,narration_url,narration_segments,feature_id,script_id,scripts!inner(sections),features!inner(title)",
    )
    .eq("id", videoId)
    .maybeSingle();

  if (!video?.recording_url || !video?.narration_url) {
    throw new Error("Missing recording_url or narration_url");
  }

  const segments = (video.narration_segments ?? []) as NarrationSegment[];
  const sections = ((video.scripts as any)?.sections ?? []) as ScriptSection[];
  const sectionTitles = sections.map((s) => s.title);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `ghl-render-${videoId}-`));
  const recPath = path.join(tmpDir, "recording.webm");
  const narrPath = path.join(tmpDir, "narration.mp3");
  const finalPath = path.join(tmpDir, "final.mp4");
  const thumbPath = path.join(tmpDir, "thumb.jpg");
  const shortsPath = path.join(tmpDir, "shorts.mp4");

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
  const logo = account.brand_logo_url
    ? await downloadCached(account.brand_logo_url, path.join(tmpDir, "logo.png"))
    : null;

  const renderStart = Date.now();
  await muxAudioVideo({
    video: recPath,
    audio: narrPath,
    intro,
    outro,
    logoPath: logo,
    segments,
    sectionTitles,
    output: finalPath,
  });

  const featureTitle = (video.features as any)?.title ?? "GHL Update";
  await makeThumbnail({ source: finalPath, output: thumbPath, label: featureTitle });

  // Shorts variant — non-fatal
  let shortsUrl: string | null = null;
  try {
    await makeShortsCut({ source: finalPath, output: shortsPath, segments });
    const shortsBuf = await fs.readFile(shortsPath);
    shortsUrl = await uploadToStorage(`videos/${videoId}-shorts.mp4`, shortsBuf, "video/mp4");
  } catch (err) {
    console.warn("[render] shorts cut failed:", err);
  }

  const [finalBuf, thumbBuf] = await Promise.all([
    fs.readFile(finalPath),
    fs.readFile(thumbPath),
  ]);
  const [finalUrl, thumbUrl] = await Promise.all([
    uploadToStorage(`videos/${videoId}.mp4`, finalBuf, "video/mp4"),
    uploadToStorage(`thumbnails/${videoId}.jpg`, thumbBuf, "image/jpeg"),
  ]);

  // Track render compute time (loose proxy: $0.005/min on Railway-class compute)
  const renderMinutes = (Date.now() - renderStart) / 60_000;
  await addVideoCost(videoId, "render", renderMinutes * 0.005);

  // Track storage cost for the final/shorts/thumbnail
  const sizeMb =
    (finalBuf.byteLength + thumbBuf.byteLength + (shortsUrl ? finalBuf.byteLength * 0.2 : 0)) /
    1_048_576;
  await addVideoCost(videoId, "storage", (sizeMb / 1024) * 0.021);

  await sb
    .from("videos")
    .update({ thumbnail_url: thumbUrl, shorts_url: shortsUrl })
    .eq("id", videoId);

  await fs.rm(tmpDir, { recursive: true, force: true });
  return { finalUrl, shortsUrl };
}

async function downloadCached(url: string, dest: string): Promise<string> {
  await downloadFromUrl(url, dest);
  return dest;
}
