import fs from "node:fs";
import { google } from "googleapis";
import { env } from "@ghl-vc/shared";

/** Returns an authenticated YouTube Data API v3 client given a stored refresh token. */
export function ytClient(refreshToken: string) {
  const oauth2 = new google.auth.OAuth2(
    env.YOUTUBE_CLIENT_ID,
    env.YOUTUBE_CLIENT_SECRET,
    env.YOUTUBE_REDIRECT_URI,
  );
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.youtube({ version: "v3", auth: oauth2 });
}

/** Stream a remote URL into a local file on disk. */
export async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download ${url} -> ${res.status}`);
  const buf = Buffer.from(new Uint8Array(await res.arrayBuffer()));
  await fs.promises.writeFile(dest, buf);
}
