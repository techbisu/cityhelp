import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // Production: fail build on TypeScript errors
  typescript: {
    ignoreBuildErrors: false,
  },
  // Security headers (supplement to proxy.ts)
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "X-Download-Options", value: "noopen" },
        ],
      },
    ];
  },
};

export default nextConfig;
