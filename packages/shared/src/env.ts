/**
 * Centralized env access. Reads `process.env` lazily so this module is safe to import in
 * both Edge runtimes and Node, and so missing values fail loudly only when actually used.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

export const env = {
  // Supabase
  get SUPABASE_URL() {
    return required("SUPABASE_URL");
  },
  get SUPABASE_ANON_KEY() {
    return required("SUPABASE_ANON_KEY");
  },
  get SUPABASE_SERVICE_ROLE_KEY() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },

  // LLM / TTS / YouTube
  get ANTHROPIC_API_KEY() {
    return required("ANTHROPIC_API_KEY");
  },
  get ELEVENLABS_API_KEY() {
    return required("ELEVENLABS_API_KEY");
  },
  get ELEVENLABS_VOICE_ID() {
    return optional("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")!;
  },
  get YOUTUBE_CLIENT_ID() {
    return required("YOUTUBE_CLIENT_ID");
  },
  get YOUTUBE_CLIENT_SECRET() {
    return required("YOUTUBE_CLIENT_SECRET");
  },
  get YOUTUBE_REDIRECT_URI() {
    return required("YOUTUBE_REDIRECT_URI");
  },

  // Optional ops
  get SLACK_WEBHOOK_URL() {
    return optional("SLACK_WEBHOOK_URL");
  },
  get RESEND_API_KEY() {
    return optional("RESEND_API_KEY");
  },

  // Worker
  get DETECT_INTERVAL_MIN() {
    return parseInt(optional("DETECT_INTERVAL_MIN", "30")!, 10);
  },
  get PER_VIDEO_BUDGET_USD() {
    return parseFloat(optional("PER_VIDEO_BUDGET_USD", "1.5")!);
  },
  get REVIEW_REQUIRED_DEFAULT() {
    return optional("REVIEW_REQUIRED_DEFAULT", "true") === "true";
  },
};
