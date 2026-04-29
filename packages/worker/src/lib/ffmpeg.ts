import ffmpeg from "fluent-ffmpeg";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { NarrationSegment } from "@ghl-vc/shared";

interface MuxArgs {
  video: string;             // recording (.webm)
  audio: string;             // concatenated narration mp3
  intro?: string | null;
  outro?: string | null;
  logoPath?: string | null;  // local path to a logo png/jpg, watermarked into top-right
  segments?: NarrationSegment[]; // for lower-thirds; falls back to no overlays
  sectionTitles?: string[];  // index-aligned with segments
  output: string;
}

const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"; // present on Playwright base image

/**
 * Combine the recording (.webm) with narration (.mp3), burn watermark + lower-thirds
 * (per-section title cards aligned to real audio timing), and optionally bookend
 * with brand intro/outro mp4s.
 */
export async function muxAudioVideo(args: MuxArgs): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `ghl-mux-`));
  const main = path.join(tmpDir, "main.mp4");

  // Filter chain: video scale → optional logo overlay → optional drawtext per section
  const filters: string[] = [];
  let last = "[0:v]";
  filters.push(`${last}scale=1920:1080[scaled]`);
  last = "[scaled]";

  if (args.logoPath) {
    filters.push(
      `${last}[2:v]overlay=W-w-40:40:format=auto:enable='between(t,0,9999)'[withlogo]`,
    );
    last = "[withlogo]";
  }

  if (args.segments?.length && args.sectionTitles?.length) {
    args.segments.forEach((seg, i) => {
      const title = (args.sectionTitles![i] ?? "").replace(/['":]/g, "").slice(0, 80);
      if (!title) return;
      const start = seg.start_seconds.toFixed(2);
      // Show lower-third for the first 4 seconds of each section
      const end = (seg.start_seconds + Math.min(4, seg.duration_seconds)).toFixed(2);
      const label = `${title}`;
      filters.push(
        `${last}drawtext=fontfile=${FONT}:text='${escapeText(label)}':fontcolor=white:fontsize=44:` +
          `box=1:boxcolor=0x000000@0.55:boxborderw=20:` +
          `x=80:y=h-text_h-100:enable='between(t,${start},${end})'[lt${i}]`,
      );
      last = `[lt${i}]`;
    });
  }

  // Final video output label
  filters.push(`${last}null[vout]`);

  // Step 1: combine into main.mp4
  await new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg().input(args.video).input(args.audio);
    if (args.logoPath) cmd.input(args.logoPath);
    cmd
      .complexFilter(filters)
      .outputOptions([
        "-map [vout]",
        "-map 1:a:0",
        "-c:v libx264",
        "-preset veryfast",
        "-crf 22",
        "-pix_fmt yuv420p",
        "-c:a aac",
        "-b:a 192k",
        "-shortest",
        "-movflags +faststart",
      ])
      .save(main)
      .on("end", () => resolve())
      .on("error", reject);
  });

  if (!args.intro && !args.outro) {
    await fs.copyFile(main, args.output);
    await fs.rm(tmpDir, { recursive: true, force: true });
    return;
  }

  // Step 2: concat intro + main + outro (must share codec)
  const parts: string[] = [];
  if (args.intro) parts.push(await normalize(args.intro, tmpDir, "intro"));
  parts.push(main);
  if (args.outro) parts.push(await normalize(args.outro, tmpDir, "outro"));

  const list = path.join(tmpDir, "concat.txt");
  await fs.writeFile(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(list)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c copy"])
      .save(args.output)
      .on("end", () => resolve())
      .on("error", reject);
  });

  await fs.rm(tmpDir, { recursive: true, force: true });
}

/** Re-encode a clip to match codec expectations of the concat demuxer. */
async function normalize(src: string, tmpDir: string, label: string): Promise<string> {
  const out = path.join(tmpDir, `${label}.mp4`);
  await new Promise<void>((resolve, reject) => {
    ffmpeg(src)
      .outputOptions([
        "-c:v libx264",
        "-preset veryfast",
        "-crf 22",
        "-c:a aac",
        "-b:a 192k",
        "-pix_fmt yuv420p",
        "-r 30",
        "-vf scale=1920:1080",
      ])
      .save(out)
      .on("end", () => resolve())
      .on("error", reject);
  });
  return out;
}

/** Take a frame at ~5s and burn the feature title onto it for the YouTube thumbnail. */
export async function makeThumbnail(args: {
  source: string;
  output: string;
  label: string;
}): Promise<void> {
  const safeLabel = args.label.replace(/['":]/g, "").slice(0, 80);
  await new Promise<void>((resolve, reject) => {
    ffmpeg(args.source)
      .seekInput(5)
      .frames(1)
      .videoFilters([
        `drawtext=fontfile=${FONT}:text='${escapeText(safeLabel)}':fontcolor=white:fontsize=72:` +
          `box=1:boxcolor=0x000000@0.6:boxborderw=20:x=(w-text_w)/2:y=h-text_h-80`,
      ])
      .save(args.output)
      .on("end", () => resolve())
      .on("error", reject);
  });
}

/**
 * Cut the most-useful 60 seconds of the final video into a 9:16 1080x1920 mp4 for
 * YouTube Shorts. We pick the longest single section if segments are provided,
 * else just the first 60s.
 */
export async function makeShortsCut(args: {
  source: string;
  output: string;
  segments?: NarrationSegment[];
}): Promise<void> {
  let startSec = 0;
  let durSec = Math.min(60, 60);

  if (args.segments?.length) {
    const longest = [...args.segments]
      .filter((s) => s.duration_seconds <= 60)
      .sort((a, b) => b.duration_seconds - a.duration_seconds)[0];
    if (longest) {
      startSec = longest.start_seconds;
      durSec = Math.min(60, longest.duration_seconds);
    }
  }

  await new Promise<void>((resolve, reject) => {
    ffmpeg(args.source)
      .seekInput(startSec)
      .duration(durSec)
      .complexFilter([
        // Center-crop to 9:16 from 16:9 source: crop a 1080-wide strip from a 1920x1080 frame? No —
        // we actually need a vertical 1080x1920 output. Take a center crop of width 608 from the
        // 1920-wide source (matching 9/16 of 1080), then scale to 1080x1920.
        "[0:v]scale=1920:1080,crop=608:1080:(in_w-608)/2:0,scale=1080:1920[v]",
      ])
      .outputOptions([
        "-map [v]",
        "-map 0:a:0?",
        "-c:v libx264",
        "-preset veryfast",
        "-crf 22",
        "-pix_fmt yuv420p",
        "-c:a aac",
        "-b:a 160k",
        "-movflags +faststart",
      ])
      .save(args.output)
      .on("end", () => resolve())
      .on("error", reject);
  });
}

function escapeText(s: string): string {
  return s.replace(/'/g, "\\'").replace(/:/g, "\\:");
}
