import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import createMDX from "@next/mdx";
import type { NextConfig } from "next";
import { listingImageHosts } from "./lib/listing-image-hosts";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  turbopack: {
    root: projectRoot,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    qualities: [75, 95],
    remotePatterns: listingImageHosts.map((hostname) => ({
      protocol: "https" as const,
      hostname,
    })),
  },
};

const withMDX = createMDX({});
export default withMDX(nextConfig);
