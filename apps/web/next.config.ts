import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.1.61"],
  transpilePackages: ["@shopify-ai-blog/i18n", "@shopify-ai-blog/shared"]
};

export default nextConfig;
