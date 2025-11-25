#!/usr/bin/env bun
/**
 * CLI runner script that runs CLI directly from source using Bun.
 * This avoids module instance mismatches between dist/ and src/ when loading gadgets.
 */
import { spawn } from "node:child_process";

const SRC_CLI = "src/cli.ts";

async function main(): Promise<void> {
  // Get CLI args
  // When run via `bun run cli arg1 arg2`, argv is:
  // [bun, scripts/cli-runner.ts, arg1, arg2]
  const args = process.argv.slice(2);

  // Run CLI directly from source - Bun handles TypeScript natively
  const proc = spawn("bun", ["run", SRC_CLI, ...args], {
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
