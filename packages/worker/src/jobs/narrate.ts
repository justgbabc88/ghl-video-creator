import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import {
  supabaseService,
  env,
  addVideoCost,
  type Account,
  type ScriptSection,
  type NarrationSegment,
  type VoicePreset,
} from "@ghl-vc/shared";
import { synthesizeSpeech } from "../lib/elevenlabs.js";
import { uploadToStorage } from "../lib/supabase.js";
import { buildSRT } from "../lib/captions.js";

/**
 * Generate one mp3 per script section, capture real durations, then concatenate to a
 * single narration mp3. Persist the per-section timing as `videos.narration_segments`
 * so the renderer can drive overlays and the publish step can compute correct
 * YouTube chapter timestamps. Generate an SRT captions file at the same time.
 */
export async function narrate(
  videoId: string,
  scriptId: string | null,
  account: Account,
): Promise<{ mp3Url: string; segments: NarrationSegment[]; captionsUrl: string }> {
  const sb = supabaseService();
  const { data: script } = await sb
    .from("scripts")
    .select("body,sections")
    .eq("id", scriptId ?? "")
    .maybeSingle();

  const sections = (script?.sections ?? []) as ScriptSection[];
  if (!sections.length) throw new Error("No script sections to narrate");

  const voiceId = pickVoice(account);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `ghl-narr-${videoId}-`));
  const segments: NarrationSegment[] = [];
  let cursorSeconds = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const sectionPath = path.join(tmpDir, `section-${i.toString().padStart(2, "0")}.mp3`);

    const audio = await synthesizeSpeech(section.narration, voiceId);
    await fs.writeFile(sectionPath, audio);

    const duration = await probeDurationSeconds(sectionPath);
    const storageKey = `narrations/${videoId}/section-${i}.mp3`;
    const url = await uploadToStorage(storageKey, audio, "audio/mpeg");

    segments.push({
      section_index: i,
      start_seconds: Number(cursorSeconds.toFixed(3)),
      duration_seconds: Number(duration.toFixed(3)),
      storage_key: storageKey,
      url,
      text: section.narration,
      characters: section.narration.length,
    });
    cursorSeconds += duration;
  }

  // Concatenate to a single narration.mp3 (used by the simple muxer; the renderer
  // can also use the per-section files if it wants finer alignment).
  const concatPath = path.join(tmpDir, "narration.mp3");
  await ffmpegConcatMp3(
    segments.map((s, i) => path.join(tmpDir, `section-${i.toString().padStart(2, "0")}.mp3`)),
    concatPath,
  );
  const concatBuf = await fs.readFile(concatPath);
  const mp3Url = await uploadToStorage(`narrations/${videoId}.mp3`, concatBuf, "audio/mpeg");

  // Captions
  const srt = buildSRT(segments, sections);
  const captionsUrl = await uploadToStorage(
    `captions/${videoId}.srt`,
    Buffer.from(srt, "utf8"),
    "application/x-subrip",
  );

  // Persist segments + captions URL
  await sb
    .from("videos")
    .update({ narration_segments: segments, captions_url: captionsUrl })
    .eq("id", videoId);

  // Cost: ElevenLabs Multilingual v2 = $0.12 / 1k chars
  const totalChars = segments.reduce((s, x) => s + x.characters, 0);
  const ttsCost = (totalChars * 0.12) / 1000;
  await addVideoCost(videoId, "tts", ttsCost);

  await fs.rm(tmpDir, { recursive: true, force: true });
  return { mp3Url, segments, captionsUrl };
}

/** Pick a voice id: weighted random across presets, else account default, else env default. */
function pickVoice(account: Account): string {
  const presets = (account.voice_presets ?? []) as VoicePreset[];
  if (presets.length > 0) {
    const totalWeight = presets.reduce((s, p) => s + (p.weight ?? 1), 0);
    let r = Math.random() * totalWeight;
    for (const p of presets) {
      r -= p.weight ?? 1;
      if (r <= 0) return p.voice_id;
    }
    return presets[0].voice_id;
  }
  return account.default_voice_id || env.ELEVENLABS_VOICE_ID;
}

async function probeDurationSeconds(file: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("close", () => resolve(parseFloat(out.trim()) || 0));
    proc.on("error", () => resolve(0));
  });
}

async function ffmpegConcatMp3(inputs: string[], output: string): Promise<void> {
  const dir = path.dirname(output);
  const list = path.join(dir, "concat-narration.txt");
  await fs.writeFile(list, inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
  return new Promise<void>((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-c",
      "copy",
      output,
    ]);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg concat failed (${code})`)),
    );
    proc.on("error", reject);
  });
}
