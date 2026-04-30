"use server";

import { revalidatePath } from "next/cache";
import { serverClient } from "@/lib/supabase";

/** Flip the pipeline_paused flag. Affects detect + pipeline cron ticks immediately. */
export async function togglePipelinePause(formData: FormData) {
  const desired = formData.get("paused") === "true";
  const sb = serverClient();
  const { data: existing } = await sb
    .from("accounts")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!existing) return;
  await sb.from("accounts").update({ pipeline_paused: desired }).eq("id", existing.id);
  revalidatePath("/", "layout"); // refresh layout banner everywhere
  revalidatePath("/settings");
}

/**
 * Single-account MVP: there is at most one row in `accounts`. We always look
 * it up by id (oldest first) and update it, so changing the email doesn't
 * accidentally create a second row whose values the worker won't see.
 */
export async function saveSettings(formData: FormData) {
  const sb = serverClient();
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return;

  const voicePresets = parseVoicePresets(String(formData.get("voice_presets") ?? ""));
  const notificationEvents = formData.getAll("notif_event").map((v) => String(v));

  const payload = {
    email,
    affiliate_link: stringOrNull(formData.get("affiliate_link")),
    brand_logo_url: stringOrNull(formData.get("brand_logo_url")),
    brand_intro_url: stringOrNull(formData.get("brand_intro_url")),
    brand_outro_url: stringOrNull(formData.get("brand_outro_url")),
    default_voice_id:
      stringOrNull(formData.get("default_voice_id")) ?? "21m00Tcm4TlvDq8ikWAM",
    review_required: formData.get("review_required") === "on",
    voice_presets: voicePresets,
    notification_settings: {
      slack: formData.get("notif_slack") === "on",
      email: formData.get("notif_email") === "on",
      events: notificationEvents,
    },
  };

  const { data: existing } = await sb
    .from("accounts")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing) {
    await sb.from("accounts").update(payload).eq("id", existing.id);
  } else {
    await sb.from("accounts").insert(payload);
  }
  revalidatePath("/settings");
}

function parseVoicePresets(raw: string): unknown[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const obj = JSON.parse(line);
        if (obj && typeof obj === "object" && obj.voice_id) return [obj];
      } catch {
        // skip malformed lines silently — UI can be improved to surface this
      }
      return [];
    });
}

function stringOrNull(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
