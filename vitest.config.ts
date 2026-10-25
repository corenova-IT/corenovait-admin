import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
  test: {
    include: ["tests/**/*.test.ts"],
    // each DB test file boots its own embedded Postgres; give the WASM time to start
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
  },
});
