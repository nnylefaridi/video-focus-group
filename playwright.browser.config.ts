import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * The browser prepares a real video, end to end, on its own local-mode dev server (port 3200) with
 * its own throwaway database and data folder. Claude is replaced by a stand-in on port 3299 that
 * answers every call with "overloaded" (529), so nothing is paid for: the test stops at the first
 * Claude call. The speech model (about 79 MB) and its runtime are downloaded by the test browser
 * from the same public CDNs the app uses. `npm run e2e:browser`.
 */
const PORT = 3200;
export const FAKE_CLAUDE_PORT = 3299;
/** Fixed, so the test (in its own process) finds the same folder; each run's review has a new id. */
export const E2E_DATA_DIR = path.join(os.tmpdir(), "panel-e2e-browser");
const dataDir = E2E_DATA_DIR;
fs.mkdirSync(dataDir, { recursive: true });

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /browser-processing\.spec\.ts/,
  timeout: 600_000,
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "node scripts/dev.mjs",
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: Boolean(process.env.PANEL_E2E_REUSE),
    timeout: 180_000,
    env: {
      PANEL_MODE: "local",
      HOST: "127.0.0.1",
      PORT: String(PORT),
      PANEL_DIST_DIR: ".next-e2e-browser",
      DATA_DIR: dataDir,
      DATABASE_URL: `pglite:${path.join(dataDir, "db")}`,
      ANTHROPIC_API_KEY: "sk-ant-test-not-a-real-key",
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${FAKE_CLAUDE_PORT}`,
      PANEL_DEV_SKIP_ANSWER_CHECK: "1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
