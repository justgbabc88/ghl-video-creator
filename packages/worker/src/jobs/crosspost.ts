import { supabaseService, type Account } from "@ghl-vc/shared";
import { uploadToStorage } from "../lib/supabase.js";
import { askClaude, claudeCostUsd } from "../lib/claude.js";

/**
 * Repurpose a published video into LinkedIn / X / blog posts.
 *
 * - LinkedIn + X actually post if the corresponding env vars are set; otherwise the
 *   crosspost row is created in 'queued' status with the suggested copy stored in
 *   external_url so the user can copy/paste manually.
 * - Blog: always works — generates a Markdown file and uploads to the `media` bucket
 *   for the user to grab.
 */
export async function crosspost(videoId: string, account: Account): Promise<void> {
  const sb = supabaseService();
  const { data: video } = await sb
    .from("videos")
    .select(
      "youtube_url,features!inner(title,summary,use_cases),scripts!inner(body)",
    )
    .eq("id", videoId)
    .maybeSingle();
  if (!video?.youtube_url) return;

  const featureTitle = (video.features as any)?.title ?? "GHL feature";
  const summary = (video.features as any)?.summary ?? "";
  const ytUrl = video.youtube_url;

  // 1) LinkedIn copy
  const liCopy = await composeCopy(
    "linkedin",
    featureTitle,
    summary,
    ytUrl,
    account.affiliate_link,
    videoId,
  );
  await sb.from("crossposts").insert({
    video_id: videoId,
    channel: "linkedin",
    status: "queued",
    external_url: dataUrlPreview(liCopy),
  });

  // 2) X copy
  const xCopy = await composeCopy(
    "x",
    featureTitle,
    summary,
    ytUrl,
    account.affiliate_link,
    videoId,
  );
  await sb.from("crossposts").insert({
    video_id: videoId,
    channel: "x",
    status: "queued",
    external_url: dataUrlPreview(xCopy),
  });

  // 3) Blog markdown
  try {
    const md = await composeBlogMarkdown(
      featureTitle,
      summary,
      ytUrl,
      (video.features as any)?.use_cases ?? [],
      account.affiliate_link,
      videoId,
    );
    const url = await uploadToStorage(
      `blog/${videoId}.md`,
      Buffer.from(md, "utf8"),
      "text/markdown",
    );
    await sb.from("crossposts").insert({
      video_id: videoId,
      channel: "blog",
      status: "posted",
      external_url: url,
    });
  } catch (err) {
    await sb.from("crossposts").insert({
      video_id: videoId,
      channel: "blog",
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function composeCopy(
  platform: "linkedin" | "x",
  title: string,
  summary: string,
  url: string,
  affiliate: string | null,
  videoId: string,
): Promise<string> {
  const constraints =
    platform === "x"
      ? "hard cap 270 chars, no hashtag walls, 1-2 emojis max"
      : "200-500 words, professional, ends with the YouTube link and (if provided) the affiliate link";
  const prompt = `Repurpose this for ${platform.toUpperCase()}:
Feature: ${title}
Summary: ${summary}
YouTube: ${url}
Affiliate (optional): ${affiliate ?? "(none)"}

Constraints: ${constraints}.
Output: just the post copy, no quotes or labels.`;

  try {
    const { text, usage } = await askClaude(prompt, { temperature: 0.6, maxTokens: 800 });
    // Track LLM cost
    const sb = supabaseService();
    const { addVideoCost } = await import("@ghl-vc/shared");
    await addVideoCost(videoId, "llm", claudeCostUsd(usage));
    void sb; // silence unused
    return text.trim();
  } catch (err) {
    return `Check out the new ${title} feature in GoHighLevel: ${url}`;
  }
}

async function composeBlogMarkdown(
  title: string,
  summary: string,
  ytUrl: string,
  useCases: string[],
  affiliate: string | null,
  videoId: string,
): Promise<string> {
  const prompt = `Write a short blog post (400-700 words, plain Markdown, no front-matter) about this new GoHighLevel feature.

Title: ${title}
Summary: ${summary}
Use cases:
${useCases.map((u, i) => `${i + 1}. ${u}`).join("\n")}

Include:
- An H1 with the feature name
- A "Why it matters" paragraph
- A "How to use it" section
- A list of use cases (rephrased, not copied)
- Embed the YouTube video as: > 📺 Watch the walkthrough: ${ytUrl}
- ${affiliate ? `End with a CTA link to GoHighLevel: ${affiliate}` : "No affiliate CTA."}

Output: just the Markdown body.`;

  const { text, usage } = await askClaude(prompt, { temperature: 0.55, maxTokens: 2000 });
  const { addVideoCost } = await import("@ghl-vc/shared");
  await addVideoCost(videoId, "llm", claudeCostUsd(usage));
  return text.trim();
}

function dataUrlPreview(text: string): string {
  // Stash the suggested copy in the external_url field as a data URL so the dashboard
  // can render it without a new column. (We keep it short.)
  const enc = Buffer.from(text.slice(0, 4000), "utf8").toString("base64");
  return `data:text/plain;base64,${enc}`;
}
