import Link from "next/link";
import { serverClient } from "@/lib/supabase";
import { saveSettings } from "./actions";

export const dynamic = "force-dynamic";

interface VoicePreset {
  id: string;
  label: string;
  voice_id: string;
  weight?: number;
}
interface NotificationSettings {
  slack?: boolean;
  email?: boolean;
  events?: ("detected" | "review_ready" | "published" | "failed")[];
}

export default async function SettingsPage() {
  const sb = serverClient();
  const { data: account } = await sb
    .from("accounts")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const ytConnected = !!account?.youtube_refresh_token;
  const ghlSession = !!account?.ghl_session_cookies;
  const presets = ((account?.voice_presets as VoicePreset[]) ?? []) as VoicePreset[];
  const notif = ((account?.notification_settings as NotificationSettings) ??
    {}) as NotificationSettings;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Section title="Connections">
        <div className="grid sm:grid-cols-2 gap-3">
          <ConnectionTile
            label="YouTube"
            status={ytConnected ? "connected" : "not connected"}
            ok={ytConnected}
            actionHref={ytConnected ? undefined : "/api/youtube/oauth/start"}
            actionLabel={ytConnected ? undefined : "Connect"}
            sub={ytConnected ? `Channel: ${account?.youtube_channel_id ?? "unknown"}` : undefined}
          />
          <ConnectionTile
            label="GHL session for recording"
            status={ghlSession ? "session stored" : "not configured"}
            ok={ghlSession}
            actionHref="/settings/ghl"
            actionLabel={ghlSession ? "Manage" : "Set up"}
          />
        </div>
      </Section>

      <form action={saveSettings} className="space-y-6">
        <Section title="Account">
          <Input name="email" label="Email" defaultValue={account?.email ?? ""} required />
        </Section>

        <Section title="Branding & affiliate">
          <Input
            name="affiliate_link"
            label="Affiliate link (appended to every video description)"
            defaultValue={account?.affiliate_link ?? ""}
          />
          <Input
            name="brand_logo_url"
            label="Logo URL (watermarked top-right)"
            defaultValue={account?.brand_logo_url ?? ""}
          />
          <Input
            name="brand_intro_url"
            label="Intro mp4 URL (optional)"
            defaultValue={account?.brand_intro_url ?? ""}
          />
          <Input
            name="brand_outro_url"
            label="Outro mp4 URL (optional)"
            defaultValue={account?.brand_outro_url ?? ""}
          />
        </Section>

        <Section title="Voice (ElevenLabs)">
          <Input
            name="default_voice_id"
            label="Default voice ID (used if no presets defined below)"
            defaultValue={account?.default_voice_id ?? "21m00Tcm4TlvDq8ikWAM"}
          />
          <label className="block">
            <span className="text-sm text-slate-600 dark:text-slate-400">
              Voice presets — one JSON object per line:{" "}
              <code className="text-xs">
                {`{"id":"educator","label":"Calm pro","voice_id":"…","weight":2}`}
              </code>
              . If any are defined, the pipeline picks one per video weighted by{" "}
              <code className="text-xs">weight</code>.
            </span>
            <textarea
              name="voice_presets"
              defaultValue={presets
                .map((p) => JSON.stringify(p))
                .join("\n")}
              rows={5}
              placeholder='{"id":"rachel","label":"Default","voice_id":"21m00Tcm4TlvDq8ikWAM","weight":1}'
              className="mt-1 block w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono"
            />
          </label>
        </Section>

        <Section title="Review queue">
          <label className="flex items-center gap-2">
            <input
              name="review_required"
              type="checkbox"
              defaultChecked={account?.review_required ?? true}
              className="h-4 w-4"
            />
            <span className="text-sm">
              Hold every video for review before publishing (recommended).
            </span>
          </label>
        </Section>

        <Section title="Notifications">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                name="notif_slack"
                type="checkbox"
                defaultChecked={notif.slack ?? true}
                className="h-4 w-4"
              />
              Slack
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                name="notif_email"
                type="checkbox"
                defaultChecked={notif.email ?? false}
                className="h-4 w-4"
              />
              Email (via Resend, sent to your account email)
            </label>
          </div>
          <fieldset className="mt-3">
            <legend className="text-sm text-slate-600 dark:text-slate-400">
              Notify on:
            </legend>
            <div className="grid sm:grid-cols-4 gap-2 mt-2 text-sm">
              {(["detected", "review_ready", "published", "failed"] as const).map((evt) => (
                <label key={evt} className="flex items-center gap-2">
                  <input
                    name="notif_event"
                    type="checkbox"
                    value={evt}
                    defaultChecked={
                      (notif.events ?? ["review_ready", "published", "failed"]).includes(evt)
                    }
                    className="h-4 w-4"
                  />
                  {evt}
                </label>
              ))}
            </div>
          </fieldset>
        </Section>

        <Section title="Skip rules">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Skip features whose title matches a regex pattern.&nbsp;
            <Link href="/skip-rules" className="text-blue-600 hover:underline">
              Manage skip rules &rarr;
            </Link>
          </p>
        </Section>

        <button
          type="submit"
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700"
        >
          Save settings
        </button>
      </form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-3">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Input(props: { name: string; label: string; defaultValue?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="text-sm text-slate-600 dark:text-slate-400">{props.label}</span>
      <input
        name={props.name}
        defaultValue={props.defaultValue}
        required={props.required}
        className="mt-1 block w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
      />
    </label>
  );
}

function ConnectionTile(props: {
  label: string;
  status: string;
  ok: boolean;
  actionHref?: string;
  actionLabel?: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex items-center justify-between">
      <div>
        <div className="text-sm font-medium">{props.label}</div>
        <div className={`text-xs ${props.ok ? "text-green-700" : "text-amber-700"}`}>
          {props.status}
        </div>
        {props.sub ? <div className="text-xs text-slate-500 mt-1">{props.sub}</div> : null}
      </div>
      {props.actionHref ? (
        <a
          href={props.actionHref}
          className="text-sm bg-blue-600 text-white rounded px-3 py-1.5 hover:bg-blue-700"
        >
          {props.actionLabel ?? "Configure"}
        </a>
      ) : null}
    </div>
  );
}
