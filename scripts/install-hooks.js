#!/usr/bin/env node

/**
 * Script to install git hooks
 * This runs automatically after `npm install` or `bun install`
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

// Check if .git directory exists (might not exist in CI or when installing as a dependency)
const gitDir = join(projectRoot, ".git");
if (!existsSync(gitDir)) {
  console.log("⚠️  .git directory not found, skipping git hooks installation");
  process.exit(0);
}

const hooksDir = join(gitDir, "hooks");
if (!existsSync(hooksDir)) {
  mkdirSync(hooksDir, { recursive: true });
}

// Install pre-commit hook
const preCommitSource = join(__dirname, "pre-commit");
const preCommitDest = join(hooksDir, "pre-commit");

// Install pre-push hook
const prePushSource = join(__dirname, "pre-push");
const prePushDest = join(hooksDir, "pre-push");

// Install commit-msg hook
const commitMsgSource = join(__dirname, "commit-msg");
const commitMsgDest = join(hooksDir, "commit-msg");

try {
  copyFileSync(preCommitSource, preCommitDest);
  chmodSync(preCommitDest, 0o755); // Make executable

  copyFileSync(commitMsgSource, commitMsgDest);
  chmodSync(commitMsgDest, 0o755); // Make executable

  copyFileSync(prePushSource, prePushDest);
  chmodSync(prePushDest, 0o755); // Make executable

  console.log("✓ Git hooks installed successfully");
  console.log("  → pre-commit hook: runs typecheck, linter and unit tests before each commit");
  console.log("  → commit-msg hook: validates commit message format using commitlint");
  console.log("  → pre-push hook: runs integration tests before each push");
} catch (error) {
  console.error("❌ Failed to install git hooks:", error.message);
  process.exit(1);
}
