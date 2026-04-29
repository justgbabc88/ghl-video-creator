"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { serverClient } from "@/lib/supabase";

/**
 * Save the Playwright storageState JSON onto the single account row. Errors are
 * surfaced via redirect query params (`?error=…`) instead of unhandled throws so
 * the user actually sees something change in the URL when something goes wrong.
 */
export async function saveGhlSession(formData: FormData) {
  const raw = String(formData.get("storageState") ?? "").trim();
  if (!raw) {
    redirect("/settings/ghl?error=empty");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    redirect("/settings/ghl?error=invalid_json");
  }
  if (!parsed || typeof parsed !== "object") {
    redirect("/settings/ghl?error=not_object");
  }
  // Be slightly forgiving — accept either { cookies, origins } or a wrapper { storageState: { ... } }
  if ((parsed as any).storageState && typeof (parsed as any).storageState === "object") {
    parsed = (parsed as any).storageState;
  }
  if (!Array.isArray((parsed as any).cookies)) {
    redirect("/settings/ghl?error=missing_cookies");
  }

  try {
    const sb = serverClient();
    const { data: existing } = await sb
      .from("accounts")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing) {
      const { error } = await sb
        .from("accounts")
        .update({ ghl_session_cookies: parsed })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await sb
        .from("accounts")
        .insert({ email: "owner@local", ghl_session_cookies: parsed });
      if (error) throw error;
    }
  } catch (err) {
    const msg = encodeURIComponent(
      err instanceof Error ? err.message.slice(0, 180) : String(err).slice(0, 180),
    );
    redirect(`/settings/ghl?error=db&detail=${msg}`);
  }

  revalidatePath("/settings/ghl");
  redirect("/settings/ghl?ok=1");
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
  redirect("/settings/ghl?ok=cleared");
}
