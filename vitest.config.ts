import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Browser tests share one display and Chrome: one file at a time.
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
