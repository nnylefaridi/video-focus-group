import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"], testTimeout: 60000, hookTimeout: 120000, env: { DATABASE_URL: "pglite:memory" } },
});
