import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { supabaseService, env } from "@ghl-vc/shared";
import type { Account } from "@ghl-vc/shared";
import { synthesizeSpeech } from "../lib/elevenlabs.js";
import { uploadToStorage } from "../lib/supabase.js";

/**
 * Synthesize the narration script section by section, concatenate to one mp3.
 * Cost is metered per character: ElevenLabs Multilingual v2 = $0.12 / 1k chars.
 */
export async function narrate(
  videoId: string,
  scriptId: string | null,
  account: Account,
): Promise<string> {
  const sb = supabaseService();
  const { data: script } = await sb
    .from("scripts")
    .select("body,sections")
    .eq("id", scriptId ?? "")
    .maybeSingle();

  const fullText: string = script?.body ?? "";
  if (!fullText) throw new Error("No narration script body");

  const voiceId = account.default_voice_id || env.ELEVENLABS_VOICE_ID;
  const audio = await synthesizeSpeech(fullText, voiceId);

  const tmp = path.join(os.tmpdir(), `ghl-narr-${videoId}.mp3`);
  await fs.writeFile(tmp, audio);
  const buf = await fs.readFile(tmp);

  const url = await uploadToStorage(`narrations/${videoId}.mp3`, buf, "audio/mpeg");

  // Track cost
  const charCount = fullText.length;
  const ttsCost = (charCount * 0.12) / 1000;
  const { data: vid } = await sb
    .from("videos")
    .select("cost_breakdown")
    .eq("id", videoId)
    .maybeSingle();
  const breakdown = ((vid?.cost_breakdown as any) ?? {}) as Record<string, number>;
  breakdown.tts = Number((breakdown.tts ?? 0) + ttsCost);
  breakdown.total = Number(
    (breakdown.llm ?? 0) + (breakdown.tts ?? 0) + (breakdown.render ?? 0) + (breakdown.storage ?? 0),
  );
  await sb.from("videos").update({ cost_breakdown: breakdown }).eq("id", videoId);

  await fs.rm(tmp, { force: true });
  return url;
}
