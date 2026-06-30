import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the local CBZ output + env files out of the build trace.
  outputFileTracingExcludes: {
    "/*": ["./.atlas-backups/**/*", "./.env.local"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
