import { serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function FeaturesPage() {
  const sb = serverClient();
  const { data } = await sb
    .from("features")
    .select("id,title,url,status,detected_at,summary")
    .order("detected_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Detected features</h1>
      <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
        {(data ?? []).length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No features yet.</div>
        ) : (
          (data ?? []).map((f) => (
            <div key={f.id} className="p-4">
              <div className="flex items-center justify-between">
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium hover:text-blue-600"
                >
                  {f.title}
                </a>
                <span className="text-xs rounded-full px-2 py-0.5 bg-slate-100 text-slate-700">
                  {f.status}
                </span>
              </div>
              {f.summary ? (
                <p className="text-sm text-slate-600 mt-1 line-clamp-2">{f.summary}</p>
              ) : null}
              <div className="text-xs text-slate-500 mt-1">
                {new Date(f.detected_at).toLocaleString()}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
