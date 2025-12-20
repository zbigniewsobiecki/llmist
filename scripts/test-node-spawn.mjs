#!/usr/bin/env node
/**
 * Node.js Integration Test for spawn utility
 *
 * This script verifies that the spawn utility works correctly in Node.js
 * (not Bun) by testing the fallback code path.
 *
 * Run after building: node scripts/test-node-spawn.mjs
 */

import { spawn } from "../packages/cli/src/spawn.ts";
import { strict as assert } from "node:assert";

console.log("🧪 Testing spawn utility in Node.js environment...\n");
console.log(`Runtime: ${typeof Bun === "undefined" ? "Node.js" : "Bun"}`);
console.log(`Node version: ${process.version}\n`);

// Verify we're actually running in Node.js
if (typeof Bun !== "undefined") {
  console.error("❌ ERROR: This test must run in Node.js, not Bun!");
  console.error("   Use: node scripts/test-node-spawn.mjs");
  process.exit(1);
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${error.message}`);
    failed++;
  }
}

// Test 1: Basic command execution
await test("Basic command execution", async () => {
  const proc = spawn(["echo", "hello"], { stdout: "pipe" });
  const exitCode = await proc.exited;
  assert.equal(exitCode, 0, "Exit code should be 0");
});

// Test 2: Stdout capturing
await test("Stdout capturing", async () => {
  const proc = spawn(["echo", "test output"], { stdout: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  assert.equal(stdout.trim(), "test output", "Should capture stdout");
  await proc.exited;
});

// Test 3: Exit code for failed command
await test("Non-zero exit code", async () => {
  const proc = spawn(["false"], {});
  const exitCode = await proc.exited;
  assert.equal(exitCode, 1, "Exit code should be 1 for 'false' command");
});

// Test 4: Stderr capturing
await test("Stderr capturing", async () => {
  const proc = spawn(["sh", "-c", "echo error >&2"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  assert.equal(stderr.trim(), "error", "Should capture stderr");
  await proc.exited;
});

// Test 5: stdin piping
await test("Stdin piping", async () => {
  const proc = spawn(["cat"], { stdin: "pipe", stdout: "pipe" });
  proc.stdin.write("hello from stdin");
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  assert.equal(stdout, "hello from stdin", "Should pipe stdin to stdout via cat");
  await proc.exited;
});

// Test 6: Working directory
await test("Working directory (cwd)", async () => {
  const proc = spawn(["pwd"], { cwd: "/tmp", stdout: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  // macOS: /tmp is symlink to /private/tmp
  assert.ok(
    stdout.trim() === "/tmp" || stdout.trim() === "/private/tmp",
    "Should use specified cwd"
  );
  await proc.exited;
});

// Test 7: Command not found
await test("Command not found error handling", async () => {
  try {
    const proc = spawn(["nonexistent-command-xyz123"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    // In Node.js, spawn succeeds but the process emits 'error'
    // Our wrapper should reject the exited promise
    await proc.exited;
    // If we get here without error, check exit code is non-zero
    assert.fail("Should have thrown or exited with error");
  } catch (error) {
    // Expected: ENOENT error
    assert.equal(error.code, "ENOENT", "Should throw ENOENT for missing command");
  }
});

// Test 8: Null streams when not piped
await test("Null streams when not piped", async () => {
  const proc = spawn(["echo", "hello"], { stdout: "ignore", stderr: "ignore" });
  assert.equal(proc.stdout, null, "stdout should be null when ignored");
  assert.equal(proc.stderr, null, "stderr should be null when ignored");
  await proc.exited;
});

// Summary
console.log("\n" + "─".repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log("\n❌ Some tests failed!");
  process.exit(1);
} else {
  console.log("\n✅ All Node.js spawn tests passed!");
  process.exit(0);
}
