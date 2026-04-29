import { notFound } from "next/navigation";
import { serverClient } from "@/lib/supabase";
import { ApproveForm, RejectForm, MetadataEditor } from "./actions-client";

export const dynamic = "force-dynamic";

export default async function VideoDetail({ params }: { params: { id: string } }) {
  const sb = serverClient();
  const { data: video } = await sb
    .from("videos")
    .select(
      "id,status,recording_url,narration_url,final_url,shorts_url,shorts_youtube_url,thumbnail_url,captions_url,youtube_url,duration_seconds,cost_breakdown,error,created_at,published_at,feature_id,script_id,features!inner(title,url,summary,use_cases),scripts(body,sections,llm_model,cost_usd)",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!video) notFound();

  const { data: pub } = await sb
    .from("publications")
    .select("title,description,tags,privacy_status,scheduled_for")
    .eq("video_id", params.id)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{(video.features as any)?.title}</h1>
        <span className="text-xs rounded-full px-2 py-0.5 bg-slate-100 text-slate-700">
          {video.status}
        </span>
      </div>

      <a
        href={(video.features as any)?.url}
        target="_blank"
        rel="noreferrer"
        className="text-sm text-blue-600 hover:underline"
      >
        Original GHL changelog entry &rarr;
      </a>

      {video.error ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error:</strong> {video.error}
        </div>
      ) : null}

      <Section title="Final video">
        {video.final_url ? (
          <video src={video.final_url} controls className="w-full rounded-md border" />
        ) : (
          <p className="text-sm text-slate-500">Not rendered yet.</p>
        )}
      </Section>

      {video.shorts_url ? (
        <Section title="Shorts cut (9:16)">
          <video
            src={video.shorts_url}
            controls
            className="w-72 rounded-md border"
            style={{ aspectRatio: "9 / 16" }}
          />
          {video.shorts_youtube_url ? (
            <p className="text-xs mt-2">
              <a
                href={video.shorts_youtube_url}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 hover:underline"
              >
                Live on YouTube Shorts &rarr;
              </a>
            </p>
          ) : null}
        </Section>
      ) : null}

      <Section title="YouTube metadata">
        <MetadataEditor
          videoId={video.id}
          editable={video.status === "review"}
          initial={{
            title: pub?.title ?? "",
            description: pub?.description ?? "",
            tags: (pub?.tags ?? []).join(", "),
            privacy_status: (pub?.privacy_status as any) ?? "public",
            scheduled_for: pub?.scheduled_for ?? "",
          }}
        />
      </Section>

      {video.status === "review" ? (
        <Section title="Review">
          <p className="text-sm text-slate-600 mb-3">
            Save your edits first, then approve to publish to YouTube. Reject to skip this
            feature permanently.
          </p>
          <div className="flex gap-3">
            <ApproveForm videoId={video.id} />
            <RejectForm videoId={video.id} />
          </div>
        </Section>
      ) : null}

      {video.youtube_url ? (
        <Section title="Live on YouTube">
          <a
            href={video.youtube_url}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:underline"
          >
            {video.youtube_url}
          </a>
        </Section>
      ) : null}

      <Section title="Cost breakdown">
        <pre className="text-xs bg-slate-50 dark:bg-slate-900 p-3 rounded overflow-x-auto">
          {JSON.stringify(video.cost_breakdown ?? {}, null, 2)}
        </pre>
      </Section>

      <Section title="Script">
        <pre className="text-xs bg-slate-50 dark:bg-slate-900 p-3 rounded overflow-x-auto whitespace-pre-wrap">
          {(video.scripts as any)?.body ?? "(no script)"}
        </pre>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
      <h2 className="font-semibold mb-3">{title}</h2>
      {children}
    </section>
  );
}
