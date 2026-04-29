import { serverClient } from "@/lib/supabase";
import { saveSettings } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const sb = serverClient();
  const { data: account } = await sb.from("accounts").select("*").limit(1).maybeSingle();
  const ytConnected = !!account?.youtube_refresh_token;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Section title="YouTube">
        {ytConnected ? (
          <p className="text-sm text-green-700">
            Connected to channel <code>{account?.youtube_channel_id ?? "(unknown)"}</code>.
          </p>
        ) : (
          <a
            href="/api/youtube/oauth/start"
            className="inline-block bg-red-600 text-white text-sm px-4 py-2 rounded hover:bg-red-700"
          >
            Connect YouTube
          </a>
        )}
      </Section>

      <form action={saveSettings} className="space-y-4">
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
            label="Logo URL (watermark)"
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
            label="Voice ID (default: Rachel)"
            defaultValue={account?.default_voice_id ?? "21m00Tcm4TlvDq8ikWAM"}
          />
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
              Hold every video in the review queue before publishing (recommended for the first 2
              weeks).
            </span>
          </label>
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
