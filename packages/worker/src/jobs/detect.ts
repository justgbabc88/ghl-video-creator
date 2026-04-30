import { createHash } from "node:crypto";
import { load } from "cheerio";
import { supabaseService, logEvent } from "@ghl-vc/shared";

const CHANGELOG_URL = "https://ideas.gohighlevel.com/changelog";

/**
 * Poll the GHL changelog and:
 *   - Insert any unseen entries (new features)
 *   - For known entries whose content has changed, queue a versioned regeneration
 *     (a new feature row with parent_feature_id pointing at the original)
 *   - Respect skip_rules (regex patterns matched against title)
 */
export async function detectFeatures(): Promise<void> {
  const sb = supabaseService();
  const { data: account } = await sb
    .from("accounts")
    .select("id,pipeline_paused")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!account) {
    console.warn("[detect] no account yet — skipping");
    return;
  }
  if (account.pipeline_paused) {
    console.log("[detect] pipeline is paused — skipping detect tick");
    return;
  }

  // Load skip rules once
  const { data: skipRulesRaw } = await sb
    .from("skip_rules")
    .select("pattern,reason")
    .eq("account_id", account.id);
  const skipRules = (skipRulesRaw ?? []).map((r) => ({
    re: safeRegex(r.pattern),
    reason: r.reason,
  }));

  const res = await fetch(CHANGELOG_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; GHLVideoCreator/0.2; +https://github.com/automaticdesigns/ghl-video-creator)",
    },
  });
  if (!res.ok) throw new Error(`changelog fetch ${res.status}`);
  const html = await res.text();
  const $ = load(html);

  // Build a map slug -> { title, url, summaryHtml }. Filter out non-feature paths
  // (rss feeds, api endpoints, the index page itself) and obviously-empty link text.
  const NON_FEATURE_SLUGS = new Set(["feed", "feed.rss", "rss", "index", ""]);
  const seen = new Map<string, { slug: string; title: string; url: string; html: string }>();
  $("a[href*='/changelog/']").each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    // Reject any path that includes /api/ or ends in .rss / .xml / .json — those aren't features
    if (/\/api\//i.test(href) || /\.(rss|xml|json|atom)(?:$|\?)/i.test(href)) return;
    const m = href.match(/\/changelog\/([a-z0-9-]+)\/?$/i);
    if (!m) return;
    const slug = m[1].toLowerCase();
    if (NON_FEATURE_SLUGS.has(slug)) return;
    if (seen.has(slug)) return;
    const title = $(el).text().trim();
    if (!title || title.length < 3) return; // skip empty / icon-only links
    if (/^(rss|feed|subscribe|all updates?|view all)$/i.test(title)) return;
    const url = href.startsWith("http") ? href : `https://ideas.gohighlevel.com${href}`;
    const block = $(el).closest("article, li, section").html() ?? $(el).parent().html() ?? title;
    seen.set(slug, { slug, title, url, html: String(block).slice(0, 8000) });
  });

  if (seen.size === 0) {
    console.warn("[detect] 0 entries parsed — check selector");
    return;
  }

  let inserted = 0;
  let regenQueued = 0;
  let skipped = 0;

  for (const entry of seen.values()) {
    if (skipRules.some(({ re }) => re && re.test(entry.title))) {
      skipped++;
      continue;
    }
    const contentHash = sha1(entry.html);

    // Look up an existing record by source_id
    const { data: existing } = await sb
      .from("features")
      .select("id,version,content_hash,status")
      .eq("account_id", account.id)
      .eq("source", "changelog")
      .eq("source_id", entry.slug)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!existing) {
      const { error } = await sb.from("features").insert({
        account_id: account.id,
        source: "changelog",
        source_id: entry.slug,
        title: entry.title,
        url: entry.url,
        raw_html: entry.html,
        status: "new",
        content_hash: contentHash,
        version: 1,
      });
      if (!error) inserted++;
      else if (!/duplicate key/i.test(error.message ?? "")) {
        console.warn("[detect] insert error:", error.message);
      }
      continue;
    }

    // Known feature — has the content meaningfully changed?
    if (existing.content_hash !== contentHash && existing.status === "ready") {
      // Mark old as superseded; insert v(N+1) as a new pending feature row that
      // pipeline will pick up. Source_id is reused but we change the source_id key
      // by appending the version to avoid the unique constraint collision.
      const newVersion = (existing.version ?? 1) + 1;
      const newSourceId = `${entry.slug}@v${newVersion}`;
      await sb.from("features").update({ status: "superseded" }).eq("id", existing.id);
      const { error } = await sb.from("features").insert({
        account_id: account.id,
        source: "changelog",
        source_id: newSourceId,
        title: entry.title,
        url: entry.url,
        raw_html: entry.html,
        status: "new",
        content_hash: contentHash,
        version: newVersion,
        parent_feature_id: existing.id,
      });
      if (!error) regenQueued++;
    }
  }

  if (inserted + regenQueued + skipped > 0) {
    await logEvent({
      kind: "detected",
      payload: { inserted, regenQueued, skipped },
    });
    console.log(`[detect] +${inserted} new, +${regenQueued} regen, ${skipped} skipped`);
  }
}

function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}
