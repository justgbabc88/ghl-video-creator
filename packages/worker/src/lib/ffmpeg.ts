import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { NarrationSegment } from "@ghl-vc/shared";

interface MuxArgs {
  video: string;
  audio: string;
  intro?: string | null;
  outro?: string | null;
  logoPath?: string | null;
  segments?: NarrationSegment[];
  sectionTitles?: string[];
  output: string;
}

const FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

/**
 * Combine recording (.webm, video-only) with narration (.mp3) and burn watermark +
 * lower-thirds. Implemented via raw `spawn("ffmpeg", ...)` so that map specifiers
 * like `-map 1:a:0` and `-map [vout]` reach ffmpeg verbatim — fluent-ffmpeg's
 * complexFilter wrapper has been observed to drop secondary maps silently.
 */
export async function muxAudioVideo(args: MuxArgs): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `ghl-mux-`));
  const main = path.join(tmpDir, "main.mp4");

  // Build the video filter chain
  const chain: string[] = [];
  let last = "[0:v]";
  chain.push(`${last}scale=1920:1080,setsar=1[scaled]`);
  last = "[scaled]";

  let logoInputIndex: number | null = null;
  if (args.logoPath) {
    logoInputIndex = 2; // input 0 = video, 1 = audio, 2 = logo
    chain.push(
      `${last}[${logoInputIndex}:v]overlay=W-w-40:40:format=auto[withlogo]`,
    );
    last = "[withlogo]";
  }

  if (args.segments?.length && args.sectionTitles?.length) {
    args.segments.forEach((seg, i) => {
      const title = (args.sectionTitles![i] ?? "").replace(/['":]/g, "").slice(0, 80);
      if (!title) return;
      const start = seg.start_seconds.toFixed(2);
      const end = (seg.start_seconds + Math.min(4, seg.duration_seconds)).toFixed(2);
      chain.push(
        `${last}drawtext=fontfile=${FONT}:text='${escapeText(title)}':fontcolor=white:fontsize=44:` +
          `box=1:boxcolor=0x000000@0.55:boxborderw=20:` +
          `x=80:y=h-text_h-100:enable='between(t,${start},${end})'[lt${i}]`,
      );
      last = `[lt${i}]`;
    });
  }
  chain.push(`${last}null[vout]`);

  const filterComplex = chain.join(";");

  const inputs: string[] = ["-i", args.video, "-i", args.audio];
  if (args.logoPath) inputs.push("-i", args.logoPath);

  const ffArgs = [
    "-y",
    ...inputs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[vout]",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "22",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    main,
  ];

  await runFfmpeg(ffArgs, "mux");

  if (!args.intro && !args.outro) {
    await fs.copyFile(main, args.output);
    await fs.rm(tmpDir, { recursive: true, force: true });
    return;
  }

  // Concat intro + main + outro (each normalized to matching codec)
  const parts: string[] = [];
  if (args.intro) parts.push(await normalize(args.intro, tmpDir, "intro"));
  parts.push(main);
  if (args.outro) parts.push(await normalize(args.outro, tmpDir, "outro"));

  const list = path.join(tmpDir, "concat.txt");
  await fs.writeFile(list, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
  await runFfmpeg(
    ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", args.output],
    "concat",
  );

  await fs.rm(tmpDir, { recursive: true, force: true });
}

async function normalize(src: string, tmpDir: string, label: string): Promise<string> {
  const out = path.join(tmpDir, `${label}.mp4`);
  await runFfmpeg(
    [
      "-y",
      "-i",
      src,
      "-vf",
      "scale=1920:1080,setsar=1",
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      out,
    ],
    `normalize-${label}`,
  );
  return out;
}

/** Take a frame at ~5s and burn the feature title onto it for the YouTube thumbnail. */
export async function makeThumbnail(args: {
  source: string;
  output: string;
  label: string;
}): Promise<void> {
  const safeLabel = args.label.replace(/['":]/g, "").slice(0, 80);
  await runFfmpeg(
    [
      "-y",
      "-ss",
      "5",
      "-i",
      args.source,
      "-frames:v",
      "1",
      "-vf",
      `drawtext=fontfile=${FONT}:text='${escapeText(safeLabel)}':fontcolor=white:fontsize=72:box=1:boxcolor=0x000000@0.6:boxborderw=20:x=(w-text_w)/2:y=h-text_h-80`,
      args.output,
    ],
    "thumbnail",
  );
}

/** 9:16 1080x1920 cut, capped at 60 seconds, with audio preserved. */
export async function makeShortsCut(args: {
  source: string;
  output: string;
  segments?: NarrationSegment[];
}): Promise<void> {
  let startSec = 0;
  let durSec = 60;

  if (args.segments?.length) {
    const longest = [...args.segments]
      .filter((s) => s.duration_seconds <= 60)
      .sort((a, b) => b.duration_seconds - a.duration_seconds)[0];
    if (longest) {
      startSec = longest.start_seconds;
      durSec = Math.min(60, Math.max(15, longest.duration_seconds));
    }
  }

  await runFfmpeg(
    [
      "-y",
      "-ss",
      String(startSec),
      "-i",
      args.source,
      "-t",
      String(durSec),
      "-filter_complex",
      "[0:v]scale=1920:1080,crop=608:1080:(in_w-608)/2:0,scale=1080:1920[v]",
      "-map",
      "[v]",
      "-map",
      "0:a:0?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      args.output,
    ],
    "shorts",
  );
}

function escapeText(s: string): string {
  return s.replace(/'/g, "\\'").replace(/:/g, "\\:");
}

async function runFfmpeg(args: string[], label: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    const errBuf: string[] = [];
    proc.stderr.on("data", (d) => errBuf.push(d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `ffmpeg ${label} exited ${code}: ${errBuf.join("").slice(-1500)}`,
          ),
        );
    });
    proc.on("error", reject);
  });
}
