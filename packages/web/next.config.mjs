/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ghl-vc/shared"],
  experimental: {
    typedRoutes: false,
    // Playwright storageState JSON for an authenticated GHL session can be several MB
    // (cookies + per-origin localStorage). Default is 1 MB which silently rejects saves.
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
