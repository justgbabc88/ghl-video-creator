import { chromium, type Browser, type BrowserContext } from "playwright";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { supabaseService } from "@ghl-vc/shared";
import type { Account, ScriptSection } from "@ghl-vc/shared";
import { uploadToStorage } from "../lib/supabase.js";

/**
 * Records a screen walkthrough using Playwright video capture.
 *
 * Limitations of v0:
 *   - We assume the script's `ghl_actions` are demonstrative descriptions; we don't
 *     literally interpret them yet. Instead, we open the changelog URL and the
 *     GoHighLevel app, scroll through, and let the narration carry the explanation.
 *     The next iteration will use Claude tool-use to translate `ghl_actions` into
 *     selector clicks (a small DSL: click("Settings"), waitFor("Integrations"), etc.).
 *
 *   - GHL session bootstrapping uses cookies stored on the account row. If they're
 *     missing, we record without logging in (still useful for changelog-only walkthroughs).
 */
export async function recordWalkthrough(
  videoId: string,
  scriptId: string | null,
  account: Account,
): Promise<string> {
  const sb = supabaseService();

  const { data: script } = await sb
    .from("scripts")
    .select("sections,feature_id,features!inner(url)")
    .eq("id", scriptId ?? "")
    .maybeSingle();

  const sections = (script?.sections ?? []) as ScriptSection[];
  const featureUrl = (script as any)?.features?.url as string | undefined;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `ghl-rec-${videoId}-`));

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: { dir: tmpDir, size: { width: 1920, height: 1080 } },
      // Restore GHL session if we have it
      storageState: account.ghl_session_cookies
        ? (account.ghl_session_cookies as any)
        : undefined,
    });

    const page = await context.newPage();

    // Phase 1: changelog page
    if (featureUrl) {
      await page.goto(featureUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);
      await scrollSlowly(page);
    }

    // Phase 2: live demo inside the GHL app (best-effort)
    await page.goto("https://app.gohighlevel.com/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Per section: a brief pause sized to approx_seconds (capped) so the audio aligns later.
    for (const s of sections) {
      const wait = Math.min(60, Math.max(15, s.approx_seconds ?? 30)) * 1000;
      await page.waitForTimeout(wait);
    }

    await context.close();
    await browser.close();
  } catch (err) {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    throw err;
  }

  // Find the .webm file Playwright wrote
  const files = await fs.readdir(tmpDir);
  const webm = files.find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error("Playwright did not produce a video file");
  const localPath = path.join(tmpDir, webm);

  const buf = await fs.readFile(localPath);
  const url = await uploadToStorage(`recordings/${videoId}.webm`, buf, "video/webm");
  await fs.rm(tmpDir, { recursive: true, force: true });
  return url;
}

async function scrollSlowly(page: import("playwright").Page) {
  for (let y = 0; y < 4000; y += 200) {
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(400);
  }
}
