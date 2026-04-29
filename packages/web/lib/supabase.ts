import { createClient } from "@supabase/supabase-js";
import { unstable_noStore as noStore } from "next/cache";

/**
 * Server-side, service-role client used in route handlers and server components.
 *
 * Important: we call `noStore()` AND override the fetch implementation with `cache: 'no-store'`.
 * `force-dynamic` on the page only disables static rendering, not Next.js's fetch cache —
 * supabase-js uses `fetch` internally and Next.js will memoize identical fetches across
 * the request lifecycle, which made our pages show stale data.
 */
export function serverClient() {
  noStore();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      // Force every supabase request to bypass Next.js's fetch cache.
      fetch: (input, init) =>
        fetch(input, { ...(init ?? {}), cache: "no-store" }),
    },
  });
}
