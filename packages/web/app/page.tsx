import Link from "next/link";
import { serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const sb = serverClient();

  const [{ count: featuresNew }, { count: videosReview }, { count: videosPublished }, { data: recent }] =
    await Promise.all([
      sb.from("features").select("*", { count: "exact", head: true }).eq("status", "new"),
      sb.from("videos").select("*", { count: "exact", head: true }).eq("status", "review"),
      sb.from("videos").select("*", { count: "exact", head: true }).eq("status", "published"),
      sb
        .from("videos")
        .select("id,status,created_at,published_at,youtube_url,feature_id,features!inner(title)")
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

  const stats = [
    { label: "New features detected", value: featuresNew ?? 0, href: "/features" },
    { label: "Awaiting review", value: videosReview ?? 0, href: "/videos?status=review" },
    { label: "Published", value: videosPublished ?? 0, href: "/videos?status=published" },
  ];

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 hover:border-blue-400"
          >
            <div className="text-sm text-slate-500">{s.label}</div>
            <div className="text-3xl font-semibold mt-1">{s.value}</div>
          </Link>
        ))}
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">Recent videos</h2>
        <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
          {(recent ?? []).length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No videos yet. The worker will detect new GHL features on its next cron tick.
            </div>
          ) : (
            (recent ?? []).map((v: any) => (
              <Link
                key={v.id}
                href={`/videos/${v.id}`}
                className="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <div className="flex flex-col">
                  <span className="font-medium">{v.features?.title ?? "(no title)"}</span>
                  <span className="text-xs text-slate-500">
                    {new Date(v.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <StatusPill status={v.status} />
                  {v.youtube_url ? (
                    <a
                      href={v.youtube_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-blue-600 hover:underline"
                    >
                      YouTube
                    </a>
                  ) : null}
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === "published"
      ? "bg-green-100 text-green-800"
      : status === "failed"
      ? "bg-red-100 text-red-800"
      : status === "review"
      ? "bg-amber-100 text-amber-800"
      : "bg-slate-100 text-slate-700";
  return <span className={`rounded-full px-2.5 py-0.5 text-xs ${color}`}>{status}</span>;
}
