import Link from "next/link";
import { serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface VideoRow {
  id: string;
  status: string;
  created_at: string;
  cost_breakdown: { llm?: number; tts?: number; render?: number; storage?: number; total?: number } | null;
  features: { title: string } | null;
}

export default async function CostDashboard() {
  const sb = serverClient();
  const { data: videos } = await sb
    .from("videos")
    .select("id,status,created_at,cost_breakdown,features!inner(title)")
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (videos ?? []) as unknown as VideoRow[];
  const totals = rows.reduce(
    (acc, v) => {
      const b = v.cost_breakdown ?? {};
      acc.llm += b.llm ?? 0;
      acc.tts += b.tts ?? 0;
      acc.render += b.render ?? 0;
      acc.storage += b.storage ?? 0;
      acc.total += b.total ?? 0;
      return acc;
    },
    { llm: 0, tts: 0, render: 0, storage: 0, total: 0 },
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Cost dashboard</h1>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Tile label="Total" value={fmt(totals.total)} bold />
        <Tile label="LLM" value={fmt(totals.llm)} />
        <Tile label="TTS" value={fmt(totals.tts)} />
        <Tile label="Render" value={fmt(totals.render)} />
        <Tile label="Storage" value={fmt(totals.storage)} />
      </div>

      <section className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 dark:bg-slate-800 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left p-3">Video</th>
              <th className="text-right p-3">LLM</th>
              <th className="text-right p-3">TTS</th>
              <th className="text-right p-3">Render</th>
              <th className="text-right p-3">Storage</th>
              <th className="text-right p-3">Total</th>
              <th className="text-left p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-slate-500">
                  No videos yet.
                </td>
              </tr>
            ) : (
              rows.map((v) => {
                const b = v.cost_breakdown ?? {};
                return (
                  <tr
                    key={v.id}
                    className="border-t border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  >
                    <td className="p-3">
                      <Link href={`/videos/${v.id}`} className="text-blue-600 hover:underline">
                        {v.features?.title ?? "(no title)"}
                      </Link>
                    </td>
                    <td className="p-3 text-right tabular-nums">{fmt(b.llm)}</td>
                    <td className="p-3 text-right tabular-nums">{fmt(b.tts)}</td>
                    <td className="p-3 text-right tabular-nums">{fmt(b.render)}</td>
                    <td className="p-3 text-right tabular-nums">{fmt(b.storage)}</td>
                    <td className="p-3 text-right tabular-nums font-semibold">{fmt(b.total)}</td>
                    <td className="p-3">
                      <span className="text-xs rounded-full px-2 py-0.5 bg-slate-100 text-slate-700">
                        {v.status}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Tile({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 ${bold ? "text-2xl font-semibold" : "text-lg"}`}>{value}</div>
    </div>
  );
}

function fmt(n: number | undefined): string {
  const v = n ?? 0;
  if (!v) return "$0.00";
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}
