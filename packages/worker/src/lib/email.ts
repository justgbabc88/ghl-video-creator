import { env } from "@ghl-vc/shared";

/**
 * Send a plain-text email via Resend. No-ops if RESEND_API_KEY is unset, so the worker
 * doesn't crash in environments where email isn't configured.
 */
export async function sendAlertEmail(args: {
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return;
  const from = process.env.RESEND_FROM ?? "alerts@ghl-video-creator.local";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: args.to,
        subject: args.subject,
        text: args.body,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.warn("[email] resend failed:", res.status, body.slice(0, 300));
    }
  } catch (err) {
    console.warn("[email] resend error:", err);
  }
}
