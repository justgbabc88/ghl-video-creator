import ffmpeg from "fluent-ffmpeg";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * Mux the screen recording (.webm) with narration (.mp3), optionally pre/post-pending
 * brand intro and outro mp4s. The narration audio replaces any sound from the recording.
 *
 * Strategy: re-encode the recording to mp4 with the narration audio track, then concat
 * with intro/outro using the concat demuxer.
 */
export async function muxAudioVideo(args: {
  video: string;
  audio: string;
  intro?: string | null;
  outro?: string | null;
  output: string;
}): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `ghl-mux-`));
  const main = path.join(tmpDir, "main.mp4");

  // Step 1: combine the recording with the narration into main.mp4
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(args.video)
      .input(args.audio)
      .outputOptions([
        "-map 0:v:0",
        "-map 1:a:0",
        "-c:v libx264",
        "-preset veryfast",
        "-crf 22",
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

  // Step 2: concat intro + main + outro using concat demuxer (all clips must share codecs).
  // We re-encode the intro and outro to match if they don't.
  const parts: string[] = [];
  if (args.intro) parts.push(await normalize(args.intro, tmpDir, "intro"));
  parts.push(main);
  if (args.outro) parts.push(await normalize(args.outro, tmpDir, "outro"));

  const list = path.join(tmpDir, "concat.txt");
  await fs.writeFile(list, parts.map((p) => `file '${p.replace(/'/g, "\\'")}'`).join("\n"));

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

/** Grab a frame at ~5s and burn the feature title onto it for the YouTube thumbnail. */
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
        `drawtext=text='${safeLabel}':fontcolor=white:fontsize=72:box=1:boxcolor=0x000000@0.6:boxborderw=20:x=(w-text_w)/2:y=h-text_h-80`,
      ])
      .save(args.output)
      .on("end", () => resolve())
      .on("error", reject);
  });
}
