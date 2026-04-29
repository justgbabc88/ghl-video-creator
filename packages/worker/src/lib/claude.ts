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
  opts: { temperature?: number; maxTokens?: number } = {},
) {
  const r = await client().messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.5,
    messages: [{ role: "user", content: prompt }],
  });

  const text = r.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();

  return {
    text,
    model: r.model,
    usage: {
      input_tokens: r.usage.input_tokens,
      output_tokens: r.usage.output_tokens,
    },
  };
}
