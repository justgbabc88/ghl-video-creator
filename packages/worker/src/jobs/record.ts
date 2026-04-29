import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
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
 * Wrapped in a hard 8-minute timeout so a stuck Playwright session can't hang the
 * whole pipeline indefinitely.
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
        () => reject(new Error("recordWalkthrough timed out after 8 minutes")),
        8 * 60 * 1000,
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

  try {
    browser = await chromium.launch({ headless: true });
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

    // 2) Live demo. If we don't have a session, this won't get past the login wall —
    // but the recording still has the changelog reading, which is useful.
    if (haveSession) {
      try {
        await page.goto("https://app.gohighlevel.com/", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(2500);
      } catch {
        /* network hiccup — continue */
      }

      // 3) For each section, ask Claude to plan recorder actions, then execute them.
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const targetMs = clampSectionMs(section);
        await runOneSection(page, section, featureTitle ?? "", videoId, targetMs);
      }
    } else {
      // No session — pad the recording to roughly the script length so audio mux works.
      for (const s of sections) {
        await page.waitForTimeout(clampSectionMs(s));
      }
    }

    await context.close();
    await browser.close();
  } catch (err) {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
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
  // Ask Claude for a recorder plan
  const dom = await readSimplifiedDOM(page);
  const prompt = `Feature title: ${featureTitle}
Section title: ${section.title}
Approx seconds: ${Math.round(targetMs / 1000)}

What the narrator says:
${section.narration}

Plain-English steps the narrator references:
${(section.ghl_actions ?? []).map((a, i) => `${i + 1}. ${a}`).join("\n")}

Currently visible on the page (truncated DOM):
${dom}

Plan recorder steps that visually demonstrate what the narrator describes.`;

  let actions: RecorderAction[] = [];
  try {
    const { data, usage } = await askClaudeJSON<RecorderAction[]>(prompt, {
      system: SYSTEM_PROMPT_PLAN,
      temperature: 0.3,
      maxTokens: 1500,
    });
    actions = Array.isArray(data) ? data : [];
    await addVideoCost(videoId, "llm", claudeCostUsd(usage));
  } catch (err) {
    console.warn("[record] planning failed for section", section.title, err);
  }

  const sectionStart = Date.now();
  await runRecorderActions(page, actions);

  // Pad to the target section duration so audio mux aligns
  const elapsed = Date.now() - sectionStart;
  const remaining = targetMs - elapsed;
  if (remaining > 0) await page.waitForTimeout(remaining);
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
