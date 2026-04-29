import { env } from "@ghl-vc/shared";

export async function notifySlack(message: string): Promise<void> {
  const url = env.SLACK_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
  } catch (err) {
    console.warn("[slack] failed:", err);
  }
}
