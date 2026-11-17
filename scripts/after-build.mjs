// Runs after every `npm run build` (npm's postbuild). A standalone build's file tracing can pick up
// this computer's data folder (its reviews, media and local database) and copy it into
// .next/standalone. Nothing there belongs in a build, so it's removed. Docker builds never have a
// data folder (.dockerignore), so this is a safeguard for builds made on a computer that has one.
import fs from "node:fs";
import path from "node:path";

export function removeTracedData(distDir) {
  const data = path.join(distDir, "standalone", "data");
  if (!fs.existsSync(data)) return false;
  fs.rmSync(data, { recursive: true, force: true });
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const distDir = path.resolve(process.env.PANEL_DIST_DIR || ".next");
  if (removeTracedData(distDir)) console.log(`Removed the data folder from ${path.relative(process.cwd(), path.join(distDir, "standalone"))} (local reviews never go into a build).`);
}
