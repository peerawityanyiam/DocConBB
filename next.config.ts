import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable Turbopack for builds (OneDrive conflict on Windows)
  experimental: {},
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
