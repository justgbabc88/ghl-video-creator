import { supabaseService } from "@ghl-vc/shared";
import fs from "node:fs/promises";

const BUCKET = "media";

/**
 * Upload a buffer to the `media` Supabase Storage bucket, returning a public URL.
 * Bucket is auto-created on first use.
 */
export async function uploadToStorage(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const sb = supabaseService();
  await ensureBucket();
  const { error } = await sb.storage.from(BUCKET).upload(key, body, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`storage upload ${key}: ${error.message}`);
  const { data } = sb.storage.from(BUCKET).getPublicUrl(key);
  return data.publicUrl;
}

let bucketEnsured = false;
async function ensureBucket() {
  if (bucketEnsured) return;
  const sb = supabaseService();
  const { data: buckets } = await sb.storage.listBuckets();
  if (!buckets?.some((b) => b.name === BUCKET)) {
    await sb.storage.createBucket(BUCKET, { public: true });
  }
  bucketEnsured = true;
}

/** Pull a public URL into a local file on disk. */
export async function downloadFromUrl(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} -> ${res.status}`);
  const buf = Buffer.from(new Uint8Array(await res.arrayBuffer()));
  await fs.writeFile(dest, buf);
}
