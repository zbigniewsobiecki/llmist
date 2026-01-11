#!/usr/bin/env node
/**
 * Postinstall script to fix @unblessed/core data path bug.
 *
 * Bug: @unblessed/core's getDataPath() resolves to dist/data but actual
 * data files are at package root's data/ directory.
 *
 * Fix: Create symlink dist/data -> ../data
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// Use require.resolve to find @unblessed/core regardless of hoisting
const require = createRequire(import.meta.url);

try {
  // Find the actual location of @unblessed/core
  const coreIndexPath = require.resolve("@unblessed/core");
  const coreDir = dirname(coreIndexPath);

  // Handle both dist/index.js and top-level index.js layouts
  const packageRoot = coreDir.endsWith("dist") ? dirname(coreDir) : coreDir;

  const distDir = join(packageRoot, "dist");
  const dataDir = join(packageRoot, "data");
  const targetPath = join(distDir, "data");

  // Only run if data directory exists but dist/data doesn't
  if (existsSync(dataDir) && existsSync(distDir) && !existsSync(targetPath)) {
    try {
      // Try symlink first (works on Unix, may fail on Windows without admin)
      symlinkSync("../data", targetPath, "junction");
    } catch {
      // Fall back to directory copy on Windows or if symlink fails
      copyDir(dataDir, targetPath);
    }
  }
} catch {
  // @unblessed/core not found - this is fine, postinstall runs for all installs
}

/**
 * Recursively copy a directory.
 */
function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}
