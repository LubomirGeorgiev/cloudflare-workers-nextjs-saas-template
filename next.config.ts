import type { NextConfig } from "next";

import withBundleAnalyzer from '@next/bundle-analyzer';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

// added by create cloudflare to enable calling `getCloudflareContext()` in `next dev`
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  experimental: {
    typedRoutes: true,
  },
  eslint: {
    ignoreDuringBuilds: process.env.SKIP_LINTER === 'true'
  },
  typescript: {
    ignoreBuildErrors: process.env.SKIP_LINTER === 'true'
  },
  // Disable middleware to avoid dynamic require issues in Cloudflare Workers
  skipMiddlewareUrlNormalize: true,
};

export default process.env.ANALYZE === 'true'
  ? withBundleAnalyzer()(nextConfig)
  : nextConfig;
