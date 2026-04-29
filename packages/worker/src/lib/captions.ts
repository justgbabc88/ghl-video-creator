import type { NarrationSegment } from "@ghl-vc/shared";

/**
 * Build an SRT captions file from per-section narration timing + script sections.
 * Splits each section's narration into rough sentence-level cues so YouTube auto-captioning
 * has a clean baseline. Word-level timing isn't available without per-word TTS marks,
 * so we approximate by splitting evenly across the section's duration.
 */
export function buildSRT(
  segments: NarrationSegment[],
  sections: { narration: string }[],
): string {
  const cues: string[] = [];
  let cueIndex = 1;

  for (const seg of segments) {
    const section = sections[seg.section_index];
    if (!section) continue;
    const sentences = splitSentences(section.narration);
    if (!sentences.length) continue;

    const charTotal = sentences.reduce((s, x) => s + x.length, 0) || 1;
    let cursorSeconds = seg.start_seconds;

    for (const s of sentences) {
      const portion = (s.length / charTotal) * seg.duration_seconds;
      const start = cursorSeconds;
      const end = cursorSeconds + portion;
      cues.push(
        `${cueIndex}\n${formatTs(start)} --> ${formatTs(end)}\n${s.replace(/\s+/g, " ").trim()}\n`,
      );
      cueIndex++;
      cursorSeconds = end;
    }
  }

  return cues.join("\n");
}

function splitSentences(text: string): string[] {
  // Naive sentence splitter that preserves trailing punctuation
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatTs(totalSeconds: number): string {
  const ms = Math.max(0, Math.round(totalSeconds * 1000));
  const hh = Math.floor(ms / 3_600_000)
    .toString()
    .padStart(2, "0");
  const mm = Math.floor((ms % 3_600_000) / 60_000)
    .toString()
    .padStart(2, "0");
  const ss = Math.floor((ms % 60_000) / 1000)
    .toString()
    .padStart(2, "0");
  const millis = (ms % 1000).toString().padStart(3, "0");
  return `${hh}:${mm}:${ss},${millis}`;
}
