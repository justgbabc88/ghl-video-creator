import Link from "next/link";
import { serverClient } from "@/lib/supabase";
import { Pipeline3D, type PipelineVideo } from "./Pipeline3D";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = [
  "queued",
  "recording",
  "narrating",
  "rendering",
  "review",
  "publishing",
] as const;

export default async function PipelinePage() {
  const sb = serverClient();

  const { data: active } = await sb
    .from("videos")
    .select("id,status,created_at,features!inner(title)")
    .in("status", ACTIVE_STATUSES as unknown as string[])
    .order("created_at", { ascending: true })
    .limit(60);

  const { data: recentlyDone } = await sb
    .from("videos")
    .select("id,status,created_at,features!inner(title)")
    .in("status", ["published", "failed"])
    .order("created_at", { ascending: false })
    .limit(8);

  const videos: PipelineVideo[] = [
    ...(active ?? []),
    ...(recentlyDone ?? []),
  ].map((v: any) => ({
    id: v.id,
    title: v.features?.title ?? "(no title)",
    status: v.status,
    createdAt: v.created_at,
  }));

  return (
    // Fixed inset-0 escapes the parent layout's max-width container, covers the
    // header + footer chrome, and gives the canvas the entire viewport.
    <div className="fixed inset-0 z-40 bg-[#cfd8c5]">
      <Pipeline3D videos={videos} />

      {/* Floating overlay UI — pointer-events-none on the wrapper so canvas
          clicks still register, then -auto only on the back link. */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-3 left-4 pointer-events-auto">
          <Link
            href="/"
            className="text-[11px] uppercase tracking-wider text-amber-50 bg-stone-900/70 hover:bg-stone-900 px-2 py-1 rounded inline-flex items-center gap-1 font-mono"
          >
            <span aria-hidden>←</span> Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
