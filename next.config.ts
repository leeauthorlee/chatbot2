import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/ingest": ["./dataset/**/*"],
  },
};

export default nextConfig;
