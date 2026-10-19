import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // `npm run dev` is how people run Panel day to day, so keep Next's dev badge off the page.
  devIndicators: false,
  partialPrefetching: true,
  serverExternalPackages: ["@electric-sql/pglite"],
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
