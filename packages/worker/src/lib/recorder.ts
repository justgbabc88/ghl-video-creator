import type { Page } from "playwright";
import type { RecorderAction } from "@ghl-vc/shared";

/**
 * Execute a sequence of recorder actions (the small DSL Claude planned). Failure of a
 * single step doesn't abort the recording — we log and move on so the video still
 * captures something useful.
 */
export async function runRecorderActions(page: Page, actions: RecorderAction[]): Promise<void> {
  for (const a of actions) {
    try {
      await runOne(page, a);
    } catch (err) {
      console.warn("[recorder] step failed", a, err instanceof Error ? err.message : err);
      // Pause briefly so the video doesn't desync wildly when a step bails
      await page.waitForTimeout(500);
    }
  }
}

async function runOne(page: Page, a: RecorderAction): Promise<void> {
  switch (a.kind) {
    case "navigate":
      await page.goto(a.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForTimeout(1500);
      return;
    case "click": {
      const el = await locate(page, a.selector);
      await el.scrollIntoViewIfNeeded();
      await flash(page, el);
      await el.click({ timeout: 8000 });
      await page.waitForTimeout(800);
      return;
    }
    case "fill": {
      const el = await locate(page, a.selector);
      await el.fill(a.text, { timeout: 8000 });
      await page.waitForTimeout(400);
      return;
    }
    case "press":
      await page.keyboard.press(a.key);
      await page.waitForTimeout(400);
      return;
    case "waitFor":
      if (a.selector) {
        await page.waitForSelector(a.selector, { timeout: 10_000 });
      } else {
        await page.waitForTimeout(a.ms ?? 1000);
      }
      return;
    case "scroll": {
      const dir = a.pixels >= 0 ? 1 : -1;
      const total = Math.abs(a.pixels);
      const step = 120;
      for (let y = 0; y < total; y += step) {
        await page.mouse.wheel(0, dir * step);
        await page.waitForTimeout(80);
      }
      return;
    }
    case "hover": {
      const el = await locate(page, a.selector);
      await el.hover({ timeout: 6000 });
      await page.waitForTimeout(700);
      return;
    }
    case "highlight": {
      const el = await locate(page, a.selector);
      await el.scrollIntoViewIfNeeded();
      await flash(page, el, a.ms ?? 1500);
      return;
    }
  }
}

/** Resolve a flexible selector that can be CSS, text="...", or role=button[name="..."]. */
async function locate(page: Page, selector: string) {
  // Allow Playwright's getByRole/getByText shorthand
  if (selector.startsWith("text=") || selector.startsWith("role=") || selector.startsWith("xpath=")) {
    return page.locator(selector);
  }
  // Plain string -> try as text content first, then as CSS
  return page.locator(`text=${selector}, ${selector}`).first();
}

/** Briefly outline an element to make recordings feel guided. */
async function flash(page: Page, el: ReturnType<Page["locator"]>, ms = 800) {
  try {
    await el.evaluate((node, duration) => {
      const original = (node as HTMLElement).style.boxShadow;
      (node as HTMLElement).style.boxShadow = "0 0 0 4px rgba(59, 130, 246, 0.85)";
      setTimeout(() => ((node as HTMLElement).style.boxShadow = original), duration);
    }, ms);
  } catch {
    // Don't fail the recording over a cosmetic flash
  }
}
