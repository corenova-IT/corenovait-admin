import { defineConfig } from "@playwright/test";

/**
 * Browser layout test: npm run test:layout (builds first).
 * Uses the Chrome installed on this PC, so no browser download is needed.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 20 * 60_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    channel: "chrome",
    baseURL: "http://localhost:3210",
    headless: true,
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: "http://localhost:3210/login",
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
});
