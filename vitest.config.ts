import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
      // the real package throws outside React Server Components; tests run in plain Node
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/empty.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // starts one throwaway MySQL 8 server for the whole run (or uses TEST_DATABASE_URL)
    globalSetup: ["tests/mysql-global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    pool: "forks",
  },
});
