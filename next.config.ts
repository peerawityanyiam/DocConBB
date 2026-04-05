import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable Turbopack for builds (OneDrive conflict on Windows)
  experimental: {},
};

export default nextConfig;
