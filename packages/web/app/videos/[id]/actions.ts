"use server";

import { revalidatePath } from "next/cache";
import { serverClient } from "@/lib/supabase";

export async function approveVideo(formData: FormData) {
  const id = String(formData.get("videoId"));
  const sb = serverClient();
  await sb
    .from("videos")
    .update({ status: "publishing" })
    .eq("id", id)
    .eq("status", "review");
  await sb.from("publications").update({
    approved_at: new Date().toISOString(),
    approved_by: "dashboard",
  }).eq("video_id", id);
  await sb.from("events").insert({ video_id: id, kind: "approved", payload: { by: "dashboard" } });
  revalidatePath(`/videos/${id}`);
}

export async function rejectVideo(formData: FormData) {
  const id = String(formData.get("videoId"));
  const sb = serverClient();
  await sb
    .from("videos")
    .update({ status: "failed", error: "Rejected by reviewer" })
    .eq("id", id)
    .eq("status", "review");
  await sb.from("events").insert({ video_id: id, kind: "rejected", payload: { by: "dashboard" } });
  revalidatePath(`/videos/${id}`);
}

export async function savePublication(formData: FormData) {
  const id = String(formData.get("videoId"));
  if (!id) return;

  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const scheduledRaw = String(formData.get("scheduled_for") ?? "").trim();
  const scheduled_for = scheduledRaw ? new Date(scheduledRaw).toISOString() : null;

  const payload = {
    title: String(formData.get("title") ?? "").trim() || null,
    description: String(formData.get("description") ?? "").trim() || null,
    tags,
    privacy_status: String(formData.get("privacy_status") ?? "public") as
      | "public"
      | "unlisted"
      | "private",
    scheduled_for,
  };

  const sb = serverClient();
  const { data: existing } = await sb
    .from("publications")
    .select("id")
    .eq("video_id", id)
    .maybeSingle();

  if (existing) {
    await sb.from("publications").update(payload).eq("id", existing.id);
  } else {
    await sb.from("publications").insert({ video_id: id, ...payload });
  }
  revalidatePath(`/videos/${id}`);
}
