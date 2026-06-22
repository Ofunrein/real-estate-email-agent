import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  outputFileTracingIncludes: {
    "/api/threads/[threadRef]/upload": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
};

export default nextConfig;
