import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@shopify-ai-blog/i18n", "@shopify-ai-blog/shared"]
};

export default nextConfig;
