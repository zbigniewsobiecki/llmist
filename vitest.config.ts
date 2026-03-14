import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    alias: {
      llmist: resolve(__dirname, "packages/llmist/src/index.ts"),
      "@llmist/testing": resolve(__dirname, "packages/testing/src/index.ts"),
    },
    include: ["packages/*/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      exclude: [
        "**/*.test.ts",
        "**/e2e/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/cli.ts",
        "**/index.ts",
      ],
    },
  },
});
