#!/usr/bin/env node

/**
 * Post-install script to fix package issues
 * This runs automatically after `npm install`
 */

import { existsSync, lstatSync, symlinkSync } from "node:fs";
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
