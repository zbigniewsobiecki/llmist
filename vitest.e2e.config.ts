import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["packages/llmist/src/e2e/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
		testTimeout: 60000,
		bail: 1,
	},
});
