import type { NextConfig } from "next";
import { SERVER_ACTION_BODY_SIZE_LIMIT } from "./src/constants";
import { IMAGE_DEVICE_SIZES } from "./src/constants/images";


const nextConfig: NextConfig = {
  cacheComponents: true,
  typedRoutes: true,
  experimental: {
    serverActions: { bodySizeLimit: SERVER_ACTION_BODY_SIZE_LIMIT },
  },
  images: { deviceSizes: IMAGE_DEVICE_SIZES },
};

export default nextConfig;
