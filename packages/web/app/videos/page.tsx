import Link from "next/link";
import { serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function VideosPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const sb = serverClient();
  let q = sb
    .from("videos")
    .select("id,status,created_at,published_at,youtube_url,feature_id,features!inner(title)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (searchParams.status) q = q.eq("status", searchParams.status);
  const { data } = await q;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Videos</h1>
      <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
        {(data ?? []).length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No videos yet.</div>
        ) : (
          (data ?? []).map((v: any) => (
            <Link
              key={v.id}
              href={`/videos/${v.id}`}
              className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <div>
                <div className="font-medium">{v.features?.title ?? "(no title)"}</div>
                <div className="text-xs text-slate-500">
                  {new Date(v.created_at).toLocaleString()}
                </div>
              </div>
              <span className="text-xs rounded-full px-2 py-0.5 bg-slate-100 text-slate-700">
                {v.status}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
