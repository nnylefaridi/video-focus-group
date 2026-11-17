import { defineConfig } from "@playwright/test";

/**
 * Hosted mode on Next.js's real server (`next build`, then `next start`), to check the things only the
 * real adapter does: the redirect to the one public address, and the health check. No Supabase, Stripe
 * or Anthropic call is made: the settings below are the right shape but not real, and the redirect is
 * sent before any session work. `npm run e2e:hosted` (it builds first, so the first run takes a minute).
 */
const PORT = 3100;
const env = {
  PANEL_MODE: "hosted",
  PANEL_DIST_DIR: ".next-hosted-e2e",
  PORT: String(PORT),
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_not_real",
  SUPABASE_SECRET_KEY: "sb_secret_not_real",
  // Nothing is listening on port 1, so the runner's database check fails at once, quietly.
  DATABASE_URL: "postgres://panel:panel@127.0.0.1:1/panel",
  HOSTED_PUBLIC_URL: `http://localhost:${PORT}`,
  KEY_ENCRYPTION_SECRET: Buffer.alloc(32, 7).toString("base64"),
  MEDIA_SECRET: Buffer.alloc(32, 9).toString("base64"),
  STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
  STRIPE_WEBHOOK_SECRET: "whsec_not_a_real_secret",
  CLIENT_IP_HEADER: "x-test-client-ip",
  DATA_DIR: ".next-hosted-e2e/data",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /hosted-server\.spec\.ts/,
  timeout: 60_000,
  webServer: {
    command: `npx next build && npx next start --hostname 127.0.0.1 --port ${PORT}`,
    // The health check answers at any address, so it's the one URL that's safe to wait on.
    url: `http://127.0.0.1:${PORT}/api/health`,
    env,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
