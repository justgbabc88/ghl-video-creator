import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { anonymizeProxy, closeAnonymizedProxy } from "proxy-chain";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import {
  supabaseService,
  addVideoCost,
  type Account,
  type ScriptSection,
  type RecorderAction,
} from "@ghl-vc/shared";
import { uploadToStorage } from "../lib/supabase.js";
import { askClaudeJSON, claudeCostUsd } from "../lib/claude.js";
import { runRecorderActions } from "../lib/recorder.js";

/**
 * Record a screen walkthrough.
 *
 *  1. Open the changelog page (always works, no login required)
 *  2. Optionally open GHL with stored session cookies
 *  3. For each section, ask Claude to plan a small DSL of recorder actions based on
 *     the section's `ghl_actions` and the live DOM. Run those actions on the page
 *     while Playwright records video.
 *
 * Wrapped in a hard 20-minute timeout so a stuck Playwright session can't hang the
 * whole pipeline indefinitely. Each section is independently bounded by its own
 * deadline (see `runOneSection`), so even if one section's actions stall, others
 * still get a fair shot.
 */
export async function recordWalkthrough(
  videoId: string,
  scriptId: string | null,
  account: Account,
): Promise<string> {
  return Promise.race([
    recordImpl(videoId, scriptId, account),
    new Promise<string>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error("recordWalkthrough timed out after 20 minutes")),
        20 * 60 * 1000,
      ),
    ),
  ]);
}

async function recordImpl(
  videoId: string,
  scriptId: string | null,
  account: Account,
): Promise<string> {
  const sb = supabaseService();

  const { data: script } = await sb
    .from("scripts")
    .select("sections,feature_id,features!inner(url,title)")
    .eq("id", scriptId ?? "")
    .maybeSingle();

  const sections = (script?.sections ?? []) as ScriptSection[];
  const featureUrl = (script as any)?.features?.url as string | undefined;
  const featureTitle = (script as any)?.features?.title as string | undefined;
  const haveSession = !!account.ghl_session_cookies;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `ghl-rec-${videoId}-`));

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let anonymizedProxyUrl: string | null = null; // local URL we'll close at the end

  try {
    // Headless Chromium can't negotiate HTTP 407 auth challenges reliably even with
    // username/password set on the launch options, so we launder the upstream
    // authenticated proxy through proxy-chain. proxy-chain spins up a local HTTP
    // proxy on a random port that handles the auth on behalf of Chromium and forwards
    // requests upstream. Chromium then talks to localhost:<port> with no auth, no 407,
    // no fuss.
    const upstream = process.env.RESIDENTIAL_PROXY_URL;
    if (upstream) {
      anonymizedProxyUrl = await anonymizeProxy(upstream);
      console.log("[record] residential proxy laundered through", anonymizedProxyUrl);
    }

    browser = await chromium.launch({
      headless: true,
      proxy: anonymizedProxyUrl ? { server: anonymizedProxyUrl } : undefined,
    });

    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: { dir: tmpDir, size: { width: 1920, height: 1080 } },
      storageState: haveSession ? (account.ghl_session_cookies as any) : undefined,
    });

    const page = await context.newPage();

    // 1) Changelog page intro
    if (featureUrl) {
      await page.goto(featureUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      await scrollSlowly(page, 2200);
    }

    // 2) Live demo. If cookies are present, try the GHL app. If GHL bounces us to
    //    login (datacenter IP fingerprinting, expired session, etc.), fall back to
    //    a changelog-only walk-through rather than burning compute on the login page.
    let usingLiveDemo = false;
    if (haveSession) {
      try {
        await page.goto("https://app.gohighlevel.com/", {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });
        await page.waitForTimeout(2500);
        usingLiveDemo = await isLoggedIntoGHL(page);
        if (!usingLiveDemo) {
          console.warn("[record] GHL session rejected (likely IP fingerprint). Falling back.");
        }
      } catch (err) {
        console.warn("[record] GHL navigation failed, falling back:", err);
      }
    }

    if (usingLiveDemo) {
      // 3a) For each section, ask Claude to plan recorder actions, then execute them.
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const targetMs = clampSectionMs(section);
        await runOneSection(page, section, featureTitle ?? "", videoId, targetMs);
      }
    } else {
      // 3b) No live demo — go back to the changelog page (which we already showed earlier)
      //     and run a section-aware walk so the lower-thirds and pacing still align.
      if (featureUrl) {
        try {
          await page.goto(featureUrl, { waitUntil: "domcontentloaded", timeout: 12_000 });
          await page.waitForTimeout(1500);
        } catch {
          /* swallow */
        }
      }
      for (const s of sections) {
        const ms = clampSectionMs(s);
        // Slow scroll throughout the section so the video isn't a static frame
        const ticks = Math.max(4, Math.floor(ms / 1500));
        const stepMs = Math.floor(ms / ticks);
        for (let t = 0; t < ticks; t++) {
          await page.mouse.wheel(0, 180);
          await page.waitForTimeout(stepMs);
        }
      }
    }

    await context.close();
    await browser.close();
    if (anonymizedProxyUrl)
      await closeAnonymizedProxy(anonymizedProxyUrl, true).catch(() => {});
  } catch (err) {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (anonymizedProxyUrl)
      await closeAnonymizedProxy(anonymizedProxyUrl, true).catch(() => {});
    throw err;
  }

  // Find the .webm Playwright wrote
  const files = await fs.readdir(tmpDir);
  const webm = files.find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error("Playwright did not produce a video file");
  const localPath = path.join(tmpDir, webm);
  const buf = await fs.readFile(localPath);

  const url = await uploadToStorage(`recordings/${videoId}.webm`, buf, "video/webm");
  // Track storage cost (roughly $0.021/GB on Supabase Pro; free tier = effectively $0).
  const sizeMb = buf.byteLength / 1_048_576;
  await addVideoCost(videoId, "storage", (sizeMb / 1024) * 0.021);

  await fs.rm(tmpDir, { recursive: true, force: true });
  return url;
}

const SYSTEM_PROMPT_PLAN = `You are planning the on-screen actions a screen recorder should take while a voiceover plays.
Your output is a JSON array of small DSL steps. The recorder runs them in order.

Step kinds (each step is one object):
  { "kind": "navigate", "url": "https://..." }
  { "kind": "click", "selector": "text=Settings" | ".btn-primary" | "role=button[name='Save']", "description": "what this clicks" }
  { "kind": "fill", "selector": "input[name=q]", "text": "..." }
  { "kind": "press", "key": "Enter" }
  { "kind": "waitFor", "selector": "text=Saved", "ms": 1500 }       (one of selector or ms)
  { "kind": "scroll", "pixels": 600 }                              (negative = up)
  { "kind": "hover", "selector": "..." }
  { "kind": "highlight", "selector": "...", "ms": 1200 }            (visual emphasis only)

Constraints:
- Prefer 'text=...' or 'role=...' selectors when possible — they survive UI changes.
- Total duration of steps should approximately match approxSeconds (use waitFor ms steps for pacing).
- If you don't recognise a selector, prefer to scroll/hover/highlight rather than guess.
- Do NOT click Logout, Delete, Disconnect, or any irreversible billing controls.
- Output ONLY the JSON array, no prose, no markdown fences.`;

async function runOneSection(
  page: Page,
  section: ScriptSection,
  featureTitle: string,
  videoId: string,
  targetMs: number,
): Promise<void> {
  // Hard deadline for this section: targetMs * 1.6, capped at 2.5 minutes. If actions
  // overshoot we abort the remaining ones so a single bad selector chain can't
  // monopolize the recording budget.
  const deadlineMs = Math.min(150_000, Math.round(targetMs * 1.6));
  const sectionStart = Date.now();
  const remaining = () => deadlineMs - (Date.now() - sectionStart);

  // 1) Plan with Claude (capped at 25s). Worst-case the call hangs and we move on.
  let actions: RecorderAction[] = [];
  try {
    const dom = await Promise.race([
      readSimplifiedDOM(page),
      new Promise<string>((resolve) => setTimeout(() => resolve("(dom read timed out)"), 4000)),
    ]);
    const prompt = `Feature title: ${featureTitle}
Section title: ${section.title}
Approx seconds: ${Math.round(targetMs / 1000)}

What the narrator says:
${section.narration}

Plain-English steps the narrator references:
${(section.ghl_actions ?? []).map((a, i) => `${i + 1}. ${a}`).join("\n")}

Currently visible on the page (truncated DOM):
${dom}

Plan recorder steps that visually demonstrate what the narrator describes. Keep the
total wall time under ${Math.round(targetMs / 1000)} seconds — fewer, more reliable
steps beat many flaky ones.`;

    const { data, usage } = await askClaudeJSON<RecorderAction[]>(prompt, {
      system: SYSTEM_PROMPT_PLAN,
      temperature: 0.3,
      maxTokens: 1200,
      timeoutMs: 25_000,
    });
    actions = Array.isArray(data) ? data : [];
    await addVideoCost(videoId, "llm", claudeCostUsd(usage));
  } catch (err) {
    console.warn("[record] planning failed for section", section.title, err);
  }

  // 2) Run actions, but stop if we hit the section deadline
  const cap = Math.max(0, remaining() - 1500); // leave 1.5s for tail-padding
  if (cap > 0) {
    await Promise.race([
      runRecorderActions(page, actions),
      new Promise<void>((resolve) => setTimeout(resolve, cap)),
    ]);
  }

  // 3) Pad to targetMs (so audio aligns) but never beyond deadline
  const padTo = Math.min(targetMs, deadlineMs);
  const used = Date.now() - sectionStart;
  if (used < padTo) await page.waitForTimeout(padTo - used);
}

function clampSectionMs(section: ScriptSection): number {
  return Math.min(120, Math.max(15, section.approx_seconds ?? 30)) * 1000;
}

async function readSimplifiedDOM(page: Page): Promise<string> {
  try {
    const text = await page.evaluate(() => {
      const interactive = Array.from(
        document.querySelectorAll(
          'a, button, input, [role="button"], [role="link"], [role="tab"], h1, h2, h3, [data-testid]',
        ),
      ).slice(0, 80);
      return interactive
        .map((el) => {
          const tag = el.tagName.toLowerCase();
          const role = (el.getAttribute("role") ?? "").trim();
          const id = (el.id ?? "").trim();
          const cls = (el.className?.toString?.() ?? "").trim().split(/\s+/).slice(0, 3).join(".");
          const txt = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
          const test = (el.getAttribute("data-testid") ?? "").trim();
          return `<${tag}${role ? ` role=${role}` : ""}${id ? ` #${id}` : ""}${cls ? ` .${cls}` : ""}${test ? ` data-testid=${test}` : ""}>${txt}</${tag}>`;
        })
        .join("\n");
    });
    return text.slice(0, 6000);
  } catch {
    return "(could not read DOM)";
  }
}

async function scrollSlowly(page: Page, total: number) {
  for (let y = 0; y < total; y += 200) {
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(350);
  }
}

/**
 * Parse a `http://user:pass@host:port` proxy URL into Playwright's proxy config shape.
 * Returns null if the env var is unset or unparseable so the recorder falls back to
 * the unproxied path.
 */
function parseProxyUrl(raw: string | undefined): {
  server: string;
  username?: string;
  password?: string;
} | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return {
      server: `${u.protocol}//${u.host}`,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch (err) {
    console.warn("[record] failed to parse RESIDENTIAL_PROXY_URL — recording unproxied");
    return null;
  }
}

/**
 * Decide whether the GHL session cookies actually got us logged in. If GHL/Cloudflare
 * rejected the cookies, we're probably sitting on the login page — bail to fallback.
 *
 * Heuristics:
 *   1. URL ends up on a /login/ or /auth/ path
 *   2. URL is no longer on app.gohighlevel.com (some flows redirect to leadconnectorhq)
 *   3. Page has a visible password input (always means we're at a login wall)
 */
async function isLoggedIntoGHL(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (!/app\.gohighlevel\.com|app\.leadconnectorhq\.com/i.test(url)) return false;
    if (/\/(login|signin|auth|verify|2fa|otp)/i.test(url)) return false;
    const hasPasswordField = await page
      .locator('input[type="password"]')
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    if (hasPasswordField) return false;
    return true;
  } catch {
    return false;
  }
}
