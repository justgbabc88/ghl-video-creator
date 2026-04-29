"use client";

import { useState, useTransition } from "react";
import { approveVideo, rejectVideo, savePublication } from "./actions";

export function ApproveForm({ videoId }: { videoId: string }) {
  return (
    <form action={approveVideo}>
      <input type="hidden" name="videoId" value={videoId} />
      <button
        type="submit"
        className="bg-green-600 text-white text-sm px-4 py-2 rounded hover:bg-green-700"
      >
        Approve & publish
      </button>
    </form>
  );
}

export function RejectForm({ videoId }: { videoId: string }) {
  return (
    <form action={rejectVideo}>
      <input type="hidden" name="videoId" value={videoId} />
      <button
        type="submit"
        className="bg-slate-200 text-slate-800 text-sm px-4 py-2 rounded hover:bg-slate-300"
      >
        Reject
      </button>
    </form>
  );
}

export function MetadataEditor(props: {
  videoId: string;
  editable: boolean;
  initial: {
    title: string;
    description: string;
    tags: string;
    privacy_status: "public" | "unlisted" | "private";
    scheduled_for: string | null;
  };
}) {
  const [title, setTitle] = useState(props.initial.title);
  const [description, setDescription] = useState(props.initial.description);
  const [tags, setTags] = useState(props.initial.tags);
  const [privacy, setPrivacy] = useState(props.initial.privacy_status);
  const [scheduled, setScheduled] = useState(props.initial.scheduled_for ?? "");
  const [pending, start] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);

  if (!props.editable) {
    return (
      <div className="space-y-2 text-sm">
        <Field label="Title" value={title} />
        <Field label="Description" value={description} multiline />
        <Field label="Tags" value={tags} />
        <Field label="Privacy" value={privacy} />
        {scheduled ? <Field label="Scheduled for" value={scheduled} /> : null}
      </div>
    );
  }

  return (
    <form
      action={(fd) => {
        fd.set("videoId", props.videoId);
        fd.set("title", title);
        fd.set("description", description);
        fd.set("tags", tags);
        fd.set("privacy_status", privacy);
        fd.set("scheduled_for", scheduled);
        start(async () => {
          await savePublication(fd);
          setSavedAt(new Date().toLocaleTimeString());
        });
      }}
      className="space-y-3 text-sm"
    >
      <label className="block">
        <span className="text-slate-600 dark:text-slate-400">Title</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          className="mt-1 block w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
        />
      </label>

      <label className="block">
        <span className="text-slate-600 dark:text-slate-400">
          Description (use{" "}
          <code className="px-1 bg-slate-100 dark:bg-slate-800 rounded">{"{{CHAPTERS}}"}</code> and{" "}
          <code className="px-1 bg-slate-100 dark:bg-slate-800 rounded">{"{{AFFILIATE}}"}</code> as
          placeholders)
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={10}
          className="mt-1 block w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono text-xs"
        />
      </label>

      <label className="block">
        <span className="text-slate-600 dark:text-slate-400">Tags (comma separated)</span>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="mt-1 block w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-slate-600 dark:text-slate-400">Privacy</span>
          <select
            value={privacy}
            onChange={(e) => setPrivacy(e.target.value as any)}
            className="mt-1 block w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
          >
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </select>
        </label>
        <label className="block">
          <span className="text-slate-600 dark:text-slate-400">
            Scheduled (UTC, optional)
          </span>
          <input
            type="datetime-local"
            value={scheduled.slice(0, 16)}
            onChange={(e) => setScheduled(e.target.value)}
            className="mt-1 block w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save metadata"}
        </button>
        {savedAt ? (
          <span className="text-xs text-green-700">Saved at {savedAt}</span>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string | null | undefined;
  multiline?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      {multiline ? (
        <pre className="whitespace-pre-wrap mt-1">{value ?? "—"}</pre>
      ) : (
        <div className="mt-1">{value ?? "—"}</div>
      )}
    </div>
  );
}
