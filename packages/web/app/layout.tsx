import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { serverClient } from "@/lib/supabase";

export const metadata = {
  title: "GHL Video Creator",
  description: "Auto-record and publish GHL feature walkthroughs.",
};

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/features", label: "Features" },
  { href: "/videos", label: "Videos" },
  { href: "/cost", label: "Cost" },
  { href: "/skip-rules", label: "Skip rules" },
  { href: "/settings", label: "Settings" },
];

async function getPipelinePaused(): Promise<boolean> {
  try {
    const sb = serverClient();
    const { data } = await sb
      .from("accounts")
      .select("pipeline_paused")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    return !!data?.pipeline_paused;
  } catch {
    return false;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const paused = await getPipelinePaused();

  return (
    <html lang="en">
      <body>
        <div className="min-h-screen flex flex-col">
          {paused ? (
            <div className="bg-amber-500 text-amber-950 text-sm font-medium px-4 py-2 text-center">
              ⏸  Video creation is paused — no new videos will be detected or advanced.{" "}
              <Link href="/settings" className="underline">
                Resume in Settings
              </Link>
            </div>
          ) : null}
          <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
              <Link href="/" className="font-semibold text-lg">
                GHL Video Creator
              </Link>
              <nav className="flex gap-5 text-sm">
                {NAV.map((n) => (
                  <Link key={n.href} href={n.href} className="hover:text-blue-600">
                    {n.label}
                  </Link>
                ))}
              </nav>
            </div>
          </header>
          <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-8">{children}</main>
          <footer className="border-t border-slate-200 dark:border-slate-800 py-4 text-center text-xs text-slate-500">
            GHL Video Creator &middot; built with Cowork
          </footer>
        </div>
      </body>
    </html>
  );
}
