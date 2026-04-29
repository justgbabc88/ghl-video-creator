import { serverClient } from "@/lib/supabase";
import { addRule, deleteRule } from "./actions";

export const dynamic = "force-dynamic";

export default async function SkipRulesPage() {
  const sb = serverClient();
  const { data: account } = await sb
    .from("accounts")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: rules } = account
    ? await sb
        .from("skip_rules")
        .select("id,pattern,reason,created_at")
        .eq("account_id", account.id)
        .order("created_at", { ascending: false })
    : { data: [] as Array<{ id: string; pattern: string; reason: string | null; created_at: string }> };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Skip rules</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Features whose <em>title</em> matches any of these regex patterns (case-insensitive)
        will be ignored by the detector. Useful for skipping billing-page tweaks, agency-only
        beta features, or anything else you'd never make a video about.
      </p>

      <section className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
        <h2 className="font-semibold mb-3 text-sm">Add rule</h2>
        <form action={addRule} className="flex gap-2 items-start">
          <input
            name="pattern"
            placeholder='e.g. ^Billing|agency.*beta'
            className="flex-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono"
            required
          />
          <input
            name="reason"
            placeholder="optional reason"
            className="flex-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700"
          >
            Add
          </button>
        </form>
      </section>

      <section className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
        {(rules ?? []).length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No skip rules yet.</div>
        ) : (
          (rules ?? []).map((r) => (
            <div
              key={r.id}
              className="p-4 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <div className="font-mono text-sm truncate">{r.pattern}</div>
                <div className="text-xs text-slate-500 truncate">
                  {r.reason ?? "—"} · added {new Date(r.created_at).toLocaleDateString()}
                </div>
              </div>
              <form action={deleteRule}>
                <input type="hidden" name="id" value={r.id} />
                <button
                  type="submit"
                  className="text-xs text-red-600 hover:text-red-700"
                  title="Delete rule"
                >
                  Delete
                </button>
              </form>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
