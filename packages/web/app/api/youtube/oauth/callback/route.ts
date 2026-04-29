import { NextResponse, type NextRequest } from "next/server";
import { google } from "googleapis";
import { serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/settings?error=no_code", req.url));

  const oauth2 = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI,
  );

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    return NextResponse.redirect(new URL("/settings?error=no_refresh_token", req.url));
  }

  oauth2.setCredentials(tokens);
  const yt = google.youtube({ version: "v3", auth: oauth2 });
  const channels = await yt.channels.list({ part: ["id", "snippet"], mine: true });
  const channelId = channels.data.items?.[0]?.id ?? null;

  const sb = serverClient();
  const { data: existing } = await sb.from("accounts").select("id").limit(1).maybeSingle();

  const update = {
    youtube_refresh_token: tokens.refresh_token,
    youtube_channel_id: channelId,
  };

  if (existing) {
    await sb.from("accounts").update(update).eq("id", existing.id);
  } else {
    await sb.from("accounts").insert({
      email: "owner@local",
      ...update,
    });
  }

  return NextResponse.redirect(new URL("/settings?ok=1", req.url));
}
