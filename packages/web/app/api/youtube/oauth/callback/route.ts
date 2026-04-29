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

  // Pull channel id and the Google account email in parallel
  const yt = google.youtube({ version: "v3", auth: oauth2 });
  const userinfo = google.oauth2({ version: "v2", auth: oauth2 });

  const [channelsRes, userInfoRes] = await Promise.all([
    yt.channels.list({ part: ["id", "snippet"], mine: true }),
    userinfo.userinfo.get().catch(() => null), // tolerate missing email scope
  ]);

  const channelId = channelsRes.data.items?.[0]?.id ?? null;
  const googleEmail = userInfoRes?.data?.email ?? null;

  const sb = serverClient();
  const { data: existing } = await sb.from("accounts").select("id,email").limit(1).maybeSingle();

  const update = {
    youtube_refresh_token: tokens.refresh_token,
    youtube_channel_id: channelId,
  };

  if (existing) {
    // Upgrade a placeholder email if one is still in place; otherwise leave the user's chosen email alone
    const shouldOverwriteEmail =
      googleEmail && (!existing.email || existing.email === "owner@local");
    await sb
      .from("accounts")
      .update(shouldOverwriteEmail ? { ...update, email: googleEmail } : update)
      .eq("id", existing.id);
  } else {
    // First connect: prefer the Google email, fall back to a placeholder only if Google didn't return one
    await sb.from("accounts").insert({
      email: googleEmail ?? "owner@local",
      ...update,
    });
  }

  return NextResponse.redirect(new URL("/settings?ok=1", req.url));
}
