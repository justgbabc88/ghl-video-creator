import type { CostBreakdown } from "./types.js";
import { supabaseService } from "./db.js";

const round = (n: number) => Number(n.toFixed(4));

/**
 * Atomically increment a cost category on videos.cost_breakdown and recompute total.
 * Reads the current jsonb value, mutates, writes it back. Single-writer pipeline so
 * no compare-and-swap dance needed.
 */
export async function addVideoCost(
  videoId: string,
  bucket: keyof CostBreakdown,
  amountUsd: number,
): Promise<CostBreakdown> {
  if (!Number.isFinite(amountUsd) || amountUsd === 0) {
    // No-op but still return the current breakdown for callers that want to see total
    const sb = supabaseService();
    const { data } = await sb
      .from("videos")
      .select("cost_breakdown")
      .eq("id", videoId)
      .maybeSingle();
    return ((data?.cost_breakdown as CostBreakdown) ?? {}) as CostBreakdown;
  }

  const sb = supabaseService();
  const { data: row } = await sb
    .from("videos")
    .select("cost_breakdown")
    .eq("id", videoId)
    .maybeSingle();

  const current = ((row?.cost_breakdown as CostBreakdown) ?? {}) as CostBreakdown;
  const updated: CostBreakdown = { ...current };
  if (bucket === "total") {
    // total is computed; ignore explicit writes
  } else {
    updated[bucket] = round((updated[bucket] ?? 0) + amountUsd);
  }
  updated.total = round(
    (updated.llm ?? 0) + (updated.tts ?? 0) + (updated.render ?? 0) + (updated.storage ?? 0),
  );

  await sb.from("videos").update({ cost_breakdown: updated }).eq("id", videoId);
  return updated;
}
