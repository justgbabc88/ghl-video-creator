import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

let _service: SupabaseClient | null = null;
let _anon: SupabaseClient | null = null;

/** Service-role client. Server-only. Bypasses RLS — never ship to a browser. */
export function supabaseService(): SupabaseClient {
  if (_service) return _service;
  _service = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _service;
}

/** Public anon client. Safe to use in the browser; obeys RLS. */
export function supabaseAnon(): SupabaseClient {
  if (_anon) return _anon;
  _anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  return _anon;
}

/** Convenience helper: append a row to the events table. Never throws — logs and swallows. */
export async function logEvent(args: {
  videoId?: string;
  featureId?: string;
  kind: string;
  payload?: unknown;
}): Promise<void> {
  try {
    await supabaseService()
      .from("events")
      .insert({
        video_id: args.videoId ?? null,
        feature_id: args.featureId ?? null,
        kind: args.kind,
        payload: args.payload ?? null,
      });
  } catch (e) {
    console.error("[logEvent] failed:", e);
  }
}
