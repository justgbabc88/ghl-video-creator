import cron from "node-cron";
import { env, logEvent } from "@ghl-vc/shared";
import { detectFeatures } from "./jobs/detect.js";
import { runPipeline } from "./pipeline.js";
import { pullAnalytics } from "./jobs/analytics.js";

/**
 * Worker entrypoint. Three loops:
 *   1. detect:    poll the GHL changelog every DETECT_INTERVAL_MIN minutes
 *   2. pipeline:  drain the work queue (any video not yet 'published'/'failed') every minute
 *   3. analytics: pull YouTube performance once a day
 *
 * Each loop is wrapped so that one tick failing never kills the process.
 */

let detectInFlight = false;
let pipelineInFlight = false;

async function safe<T>(label: string, fn: () => Promise<T>) {
  try {
    await fn();
  } catch (err) {
    console.error(`[${label}] error:`, err);
    await logEvent({ kind: `${label}_error`, payload: { message: String(err) } });
  }
}

const detectMin = Math.max(1, env.DETECT_INTERVAL_MIN);
const detectExpr = `*/${detectMin} * * * *`; // every N minutes

cron.schedule(detectExpr, async () => {
  if (detectInFlight) return;
  detectInFlight = true;
  await safe("detect", detectFeatures);
  detectInFlight = false;
});

cron.schedule("* * * * *", async () => {
  if (pipelineInFlight) return;
  pipelineInFlight = true;
  await safe("pipeline", runPipeline);
  pipelineInFlight = false;
});

cron.schedule("0 7 * * *", async () => {
  await safe("analytics", pullAnalytics);
});

console.log(
  `[worker] up. detect every ${detectMin}m, pipeline every 1m, analytics 07:00 UTC daily.`,
);

// Run a detect tick on boot so we don't wait the full interval the first time.
safe("detect_boot", detectFeatures).then(() => safe("pipeline_boot", runPipeline));

// Keep the process alive forever
setInterval(() => {}, 1 << 30);
