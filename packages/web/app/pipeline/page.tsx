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

  // Active pipeline videos
  const { data: active } = await sb
    .from("videos")
    .select("id,status,created_at,features!inner(title)")
    .in("status", ACTIVE_STATUSES as unknown as string[])
    .order("created_at", { ascending: true })
    .limit(60);

  // Recent terminal videos so the dashboard isn't empty when nothing's in flight
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
    <div className="space-y-4 -mx-6 -my-8 sm:-mx-0 sm:-my-0">
      <div className="px-6 pt-8 sm:px-0 sm:pt-0">
        <h1 className="text-2xl font-semibold">Pipeline</h1>
        <p className="text-sm text-slate-500 mt-1">
          Drag to orbit · scroll to zoom · click a card to open the video
        </p>
      </div>
      <Pipeline3D videos={videos} />
    </div>
  );
}
