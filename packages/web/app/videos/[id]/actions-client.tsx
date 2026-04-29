"use client";

import { approveVideo, rejectVideo } from "./actions";

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
