/** Domain types — kept in sync with supabase/migrations/. */

export type FeatureStatus = "new" | "scripting" | "ready" | "skipped" | "superseded";

export type VideoStatus =
  | "queued"
  | "recording"
  | "narrating"
  | "rendering"
  | "review"
  | "publishing"
  | "published"
  | "failed";

export interface VoicePreset {
  id: string; // user-defined slug
  label: string;
  voice_id: string; // ElevenLabs voice id
  weight?: number; // for weighted random selection
}

export interface NotificationSettings {
  slack?: boolean;
  email?: boolean;
  events?: ("detected" | "review_ready" | "published" | "failed")[];
}

export interface Account {
  id: string;
  email: string;
  youtube_channel_id: string | null;
  youtube_refresh_token: string | null;
  affiliate_link: string | null;
  default_voice_id: string;
  brand_intro_url: string | null;
  brand_outro_url: string | null;
  brand_logo_url: string | null;
  ghl_session_cookies: unknown | null;
  review_required: boolean;
  voice_presets: VoicePreset[];
  notification_settings: NotificationSettings;
  created_at: string;
}

export interface Feature {
  id: string;
  account_id: string;
  source: "changelog" | "rss" | "marketplace";
  source_id: string;
  title: string;
  url: string;
  raw_html: string | null;
  summary: string | null;
  use_cases: string[] | null;
  detected_at: string;
  status: FeatureStatus;
  parent_feature_id: string | null;
  content_hash: string | null;
  version: number;
}

/** A single step the on-screen recorder should perform. Compiled to Playwright operations. */
export type RecorderAction =
  | { kind: "navigate"; url: string }
  | { kind: "click"; selector: string; description?: string }
  | { kind: "fill"; selector: string; text: string }
  | { kind: "press"; key: string }
  | { kind: "waitFor"; selector?: string; ms?: number }
  | { kind: "scroll"; pixels: number }
  | { kind: "hover"; selector: string }
  | { kind: "highlight"; selector: string; ms?: number };

export interface ScriptSection {
  title: string;
  narration: string;
  ghl_actions: string[];      // imperative steps, plain English (input to recorder planner)
  approx_seconds: number;
}

export interface ScriptRow {
  id: string;
  feature_id: string;
  version: number;
  body: string;
  sections: ScriptSection[] | null;
  llm_model: string | null;
  cost_usd: number | null;
  created_at: string;
}

export interface NarrationSegment {
  section_index: number;
  start_seconds: number;
  duration_seconds: number;
  storage_key: string;        // path within media bucket
  url: string;
  text: string;
  characters: number;
}

export interface VideoRow {
  id: string;
  feature_id: string;
  script_id: string | null;
  status: VideoStatus;
  recording_url: string | null;
  narration_url: string | null;
  narration_segments: NarrationSegment[] | null;
  captions_url: string | null;
  final_url: string | null;
  shorts_url: string | null;
  shorts_youtube_video_id: string | null;
  shorts_youtube_url: string | null;
  thumbnail_url: string | null;
  youtube_video_id: string | null;
  youtube_url: string | null;
  duration_seconds: number | null;
  cost_breakdown: CostBreakdown | null;
  supersedes_video_id: string | null;
  error: string | null;
  created_at: string;
  published_at: string | null;
}

export interface CostBreakdown {
  llm?: number;
  tts?: number;
  render?: number;
  storage?: number;
  total?: number;
}

export interface Publication {
  id: string;
  video_id: string;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  category_id: number | null;
  privacy_status: "public" | "unlisted" | "private";
  scheduled_for: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

export interface Crosspost {
  id: string;
  video_id: string;
  channel: "linkedin" | "x" | "blog";
  external_id: string | null;
  external_url: string | null;
  status: "queued" | "posted" | "failed" | "skipped";
  error: string | null;
  created_at: string;
}
