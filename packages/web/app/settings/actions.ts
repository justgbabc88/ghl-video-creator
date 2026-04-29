"use server";

import { revalidatePath } from "next/cache";
import { serverClient } from "@/lib/supabase";

export async function saveSettings(formData: FormData) {
  const sb = serverClient();
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return;

  const payload = {
    email,
    affiliate_link: stringOrNull(formData.get("affiliate_link")),
    brand_logo_url: stringOrNull(formData.get("brand_logo_url")),
    brand_intro_url: stringOrNull(formData.get("brand_intro_url")),
    brand_outro_url: stringOrNull(formData.get("brand_outro_url")),
    default_voice_id:
      stringOrNull(formData.get("default_voice_id")) ?? "21m00Tcm4TlvDq8ikWAM",
    review_required: formData.get("review_required") === "on",
  };

  const { data: existing } = await sb.from("accounts").select("id").eq("email", email).maybeSingle();
  if (existing) {
    await sb.from("accounts").update(payload).eq("id", existing.id);
  } else {
    await sb.from("accounts").insert(payload);
  }
  revalidatePath("/settings");
}

function stringOrNull(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}
