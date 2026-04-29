import { load } from "cheerio";
import { supabaseService, logEvent } from "@ghl-vc/shared";

const CHANGELOG_URL = "https://ideas.gohighlevel.com/changelog";

/**
 * Poll the GHL changelog and insert any entries we haven't seen before.
 * Each entry on ideas.gohighlevel.com has a stable slug we use as `source_id`,
 * so the unique (account_id, source, source_id) constraint dedupes for free.
 */
export async function detectFeatures(): Promise<void> {
  const sb = supabaseService();
  const { data: account } = await sb.from("accounts").select("id").limit(1).maybeSingle();
  if (!account) {
    console.warn("[detect] no account yet — skipping");
    return;
  }

  const res = await fetch(CHANGELOG_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; GHLVideoCreator/0.1; +https://github.com/automaticdesigns/ghl-video-creator)",
    },
  });
  if (!res.ok) throw new Error(`changelog fetch ${res.status}`);
  const html = await res.text();
  const $ = load(html);

  // Each changelog post is a /changelog/<slug> link — selector may need to adapt as the
  // marketing site changes. We grab unique slugs and titles defensively.
  const seen = new Set<string>();
  const entries: { slug: string; title: string; url: string }[] = [];
  $("a[href*='/changelog/']").each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    const m = href.match(/\/changelog\/([a-z0-9-]+)/i);
    if (!m) return;
    const slug = m[1];
    if (seen.has(slug)) return;
    seen.add(slug);
    const title = $(el).text().trim() || slug.replace(/-/g, " ");
    const url = href.startsWith("http") ? href : `https://ideas.gohighlevel.com${href}`;
    entries.push({ slug, title, url });
  });

  if (entries.length === 0) {
    console.warn("[detect] 0 entries parsed — check selector");
    return;
  }

  let inserted = 0;
  for (const e of entries) {
    const { error } = await sb.from("features").insert({
      account_id: account.id,
      source: "changelog",
      source_id: e.slug,
      title: e.title,
      url: e.url,
      raw_html: null,
      status: "new",
    });
    if (!error) inserted++;
    else if (!/duplicate key/i.test(error.message ?? "")) {
      console.warn("[detect] insert error:", error.message);
    }
  }

  if (inserted > 0) {
    await logEvent({ kind: "detected", payload: { count: inserted } });
    console.log(`[detect] +${inserted} new features`);
  }
}
