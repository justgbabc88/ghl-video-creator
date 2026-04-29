"use server";

import { revalidatePath } from "next/cache";
import { serverClient } from "@/lib/supabase";

export async function addRule(formData: FormData) {
  const pattern = String(formData.get("pattern") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!pattern) return;

  // Validate regex; reject before insert so the user gets a clear error
  try {
    new RegExp(pattern, "i");
  } catch (e) {
    throw new Error(`Invalid regex: ${(e as Error).message}`);
  }

  const sb = serverClient();
  const { data: account } = await sb
    .from("accounts")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!account) throw new Error("Set up an account first via /settings");

  await sb.from("skip_rules").insert({ account_id: account.id, pattern, reason });
  revalidatePath("/skip-rules");
}

export async function deleteRule(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const sb = serverClient();
  await sb.from("skip_rules").delete().eq("id", id);
  revalidatePath("/skip-rules");
}
