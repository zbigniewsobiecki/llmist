#!/usr/bin/env node
/**
 * CLI runner script that runs CLI directly from source using tsx.
 * This avoids module instance mismatches between dist/ and src/ when loading gadgets.
 */
import { spawn } from "node:child_process";

const SRC_CLI = "src/cli.ts";

async function main(): Promise<void> {
  // Get CLI args
  // When run via `npm run cli arg1 arg2`, argv is:
  // [node, scripts/cli-runner.ts, arg1, arg2]
  const args = process.argv.slice(2);

  // Run CLI directly from source using tsx for TypeScript
  const proc = spawn("npx", ["tsx", SRC_CLI, ...args], {
    stdio: "inherit",
  });

  proc.on("close", (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
