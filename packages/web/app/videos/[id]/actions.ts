"use server";

import { revalidatePath } from "next/cache";
import { serverClient } from "@/lib/supabase";

/** Mark a video as approved. The worker watches for status='publishing' and uploads to YouTube. */
export async function approveVideo(formData: FormData) {
  const id = String(formData.get("videoId"));
  const sb = serverClient();
  await sb
    .from("videos")
    .update({ status: "publishing" })
    .eq("id", id)
    .eq("status", "review");
  await sb.from("events").insert({ video_id: id, kind: "approved", payload: { by: "dashboard" } });
  revalidatePath(`/videos/${id}`);
}

/** Mark as failed (skipped). Won't be retried. */
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
