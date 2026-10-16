import fs from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Tests branch on whether the app has an API key, so read the same env file the app does.
if (fs.existsSync(".env.local")) process.loadEnvFile(".env.local");

/** Browser tests run against the dev app on port 3000 (started automatically if it isn't running). */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3000" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
