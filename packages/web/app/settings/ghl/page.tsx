import { serverClient } from "@/lib/supabase";
import { saveGhlSession, clearGhlSession } from "./actions";

export const dynamic = "force-dynamic";

export default async function GhlSessionPage() {
  const sb = serverClient();
  const { data: account } = await sb
    .from("accounts")
    .select("ghl_session_cookies")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const hasSession = !!account?.ghl_session_cookies;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">GHL session for screen recording</h1>

      <p className="text-sm text-slate-600 dark:text-slate-400">
        The recorder needs to log in to your GoHighLevel account so it can demo features
        inside the app rather than just narrating over the changelog page. Paste a Playwright
        <code className="mx-1 px-1.5 py-0.5 bg-slate-200 dark:bg-slate-800 rounded text-xs">storageState</code>
        JSON below. Status:&nbsp;
        <span className={hasSession ? "text-green-700" : "text-amber-700"}>
          {hasSession ? "session stored" : "no session — recordings will be generic"}
        </span>
      </p>

      <details className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 text-sm">
        <summary className="cursor-pointer font-medium">How to get your storageState JSON</summary>
        <ol className="list-decimal pl-5 mt-3 space-y-2 text-slate-600 dark:text-slate-400">
          <li>Install Playwright on any machine: <code>npm i -D playwright &amp;&amp; npx playwright install chromium</code></li>
          <li>Run <code>npx playwright codegen --save-storage=ghl-session.json https://app.gohighlevel.com</code></li>
          <li>A browser will open. Log in to GoHighLevel like you normally would, then close the window.</li>
          <li>Open <code>ghl-session.json</code>, copy the entire contents, and paste below.</li>
        </ol>
        <p className="mt-3 text-xs text-amber-700">
          The session is sensitive — anyone with these cookies could take actions on your GHL
          account until you log out everywhere. Stored encrypted at rest in Supabase; only the
          service-role key can read it.
        </p>
      </details>

      <form action={saveGhlSession} className="space-y-3">
        <label className="block">
          <span className="text-sm text-slate-600 dark:text-slate-400">storageState JSON</span>
          <textarea
            name="storageState"
            placeholder='{"cookies":[…],"origins":[…]}'
            rows={14}
            className="mt-1 block w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-xs"
            required
          />
        </label>
        <div className="flex gap-3">
          <button
            type="submit"
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700"
          >
            Save session
          </button>
          {hasSession ? (
            <button
              type="submit"
              formAction={clearGhlSession}
              className="bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm px-4 py-2 rounded hover:bg-slate-300 dark:hover:bg-slate-700"
            >
              Clear stored session
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
