/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ghl-vc/shared"],
  experimental: { typedRoutes: false },
};

export default nextConfig;
