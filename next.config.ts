import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keep security upgrade reminders on. This does not upgrade the app by itself.
    agentUpgrade: "security",
  },
  // Only the hosted-mode browser test sets this, so its build doesn't overwrite the .next that `npm run dev` is using.
  distDir: process.env.PANEL_DIST_DIR || ".next",
  // The Docker image runs the self-contained server.js (set only by its build, so `npm run build`
  // and `npm start` on your computer stay as they are, with data/ beside the code).
  output: process.env.PANEL_STANDALONE === "1" ? "standalone" : undefined,
  // Read with fs at run time, so Next's file tracing can't see them: the standalone server needs them copied in.
  outputFileTracingIncludes: { "/*": ["./src/experts/profiles/**", "./supabase/migrations/**"] },
  // Hosted mode's redirect to the one public address (src/proxy.ts) must be sent as written. By
  // default Next rewrites a Location it thinks is "the same host", and treats 127.0.0.1 as localhost.
  skipProxyUrlNormalize: true,
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
