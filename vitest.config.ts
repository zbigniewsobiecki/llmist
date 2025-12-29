import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
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
