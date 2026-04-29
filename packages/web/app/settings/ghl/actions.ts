"use server";

import { revalidatePath } from "next/cache";
import { serverClient } from "@/lib/supabase";

export async function saveGhlSession(formData: FormData) {
  const raw = String(formData.get("storageState") ?? "").trim();
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON — please paste the full Playwright storageState contents");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Expected a JSON object with cookies/origins");
  }

  const sb = serverClient();
  const { data: existing } = await sb
    .from("accounts")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing) {
    await sb.from("accounts").update({ ghl_session_cookies: parsed }).eq("id", existing.id);
  } else {
    // Allow saving the session before any other settings exist, with a placeholder email
    await sb.from("accounts").insert({ email: "owner@local", ghl_session_cookies: parsed });
  }
  revalidatePath("/settings/ghl");
}

export async function clearGhlSession() {
  const sb = serverClient();
  const { data: existing } = await sb
    .from("accounts")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) {
    await sb.from("accounts").update({ ghl_session_cookies: null }).eq("id", existing.id);
  }
  revalidatePath("/settings/ghl");
}
