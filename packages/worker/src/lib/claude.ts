import Anthropic from "@anthropic-ai/sdk";
import { env } from "@ghl-vc/shared";

const MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return _client;
}

export async function askClaude(
  prompt: string,
  opts: { temperature?: number; maxTokens?: number; system?: string } = {},
) {
  const r = await client().messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.5,
    system: opts.system,
    messages: [{ role: "user", content: prompt }],
  });

  const text = r.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  return {
    text,
    model: r.model,
    usage: { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens },
  };
}

/** Ask Claude for structured JSON. Strips code fences before parsing. */
export async function askClaudeJSON<T = unknown>(
  prompt: string,
  opts: { temperature?: number; maxTokens?: number; system?: string } = {},
): Promise<{ data: T; model: string; usage: { input_tokens: number; output_tokens: number } }> {
  const { text, model, usage } = await askClaude(prompt, opts);
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return { data: JSON.parse(cleaned) as T, model, usage };
}

/**
 * Compute USD cost for a Claude Sonnet 4.6 call. Sonnet 4.6 = $3 / $15 per 1M tokens.
 */
export function claudeCostUsd(usage: { input_tokens: number; output_tokens: number }): number {
  return (usage.input_tokens * 3 + usage.output_tokens * 15) / 1_000_000;
}
