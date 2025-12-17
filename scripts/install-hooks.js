#!/usr/bin/env node

/**
 * Script to install git hooks and fix package issues
 * This runs automatically after `npm install` or `bun install`
 */

import { chmodSync, copyFileSync, existsSync, mkdirSync, symlinkSync, lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

// Fix @unblessed/core data path issue
// The package looks for data at dist/data but it's actually at ./data
const unblessedDist = join(projectRoot, "node_modules", "@unblessed", "core", "dist");
const unblessedDataLink = join(unblessedDist, "data");
const unblessedDataTarget = join("..", "data"); // Relative path: dist/data -> ../data

if (existsSync(unblessedDist) && !existsSync(unblessedDataLink)) {
  try {
    symlinkSync(unblessedDataTarget, unblessedDataLink);
    console.log("✓ Fixed @unblessed/core data path (created symlink)");
  } catch (error) {
    // Might fail if symlink already exists or permission issues
    if (error.code !== "EEXIST") {
      console.warn("⚠️  Could not create @unblessed/core data symlink:", error.message);
    }
  }
} else if (existsSync(unblessedDataLink)) {
  // Check if it's already a symlink pointing to the right place
  try {
    const stats = lstatSync(unblessedDataLink);
    if (stats.isSymbolicLink()) {
      console.log("✓ @unblessed/core data symlink already exists");
    }
  } catch {
    // Ignore stat errors
  }
}

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
