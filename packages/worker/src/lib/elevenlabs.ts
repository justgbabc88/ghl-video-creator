import { env } from "@ghl-vc/shared";

/**
 * Synthesize speech via ElevenLabs Multilingual v2. Returns mp3 bytes.
 * The official `elevenlabs` SDK works too, but a single fetch keeps the dep light.
 */
export async function synthesizeSpeech(text: string, voiceId: string): Promise<Buffer> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 300)}`);
  }

  const arr = new Uint8Array(await res.arrayBuffer());
  return Buffer.from(arr);
}
