#!/usr/bin/env node
/**
 * Syncs version across all packages in the monorepo.
 * Used by semantic-release before npm publish.
 *
 * Usage:
 *   node scripts/sync-versions.js [version]
 *
 * If version is provided as argument, uses that version.
 * Otherwise falls back to reading from packages/llmist/package.json.
 *
 * This script:
 * 1. Updates all package versions to match
 * 2. Syncs internal llmist dependency versions across packages
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PACKAGES = ["packages/llmist", "packages/cli", "packages/testing"];

// Internal packages that should be synced
const INTERNAL_PACKAGES = ["llmist", "@llmist/cli", "@llmist/testing"];

// Get version from command line argument or fallback to llmist package.json
let version = process.argv[2];
if (!version) {
  const llmistPkg = JSON.parse(readFileSync(join(ROOT, "packages/llmist/package.json"), "utf8"));
  version = llmistPkg.version;
}

console.log(`Syncing version ${version} across packages...`);

for (const pkgPath of PACKAGES) {
  const pkgJsonPath = join(ROOT, pkgPath, "package.json");
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));

  // Update version
  pkg.version = version;

  // Sync internal package dependencies to the new version
  for (const depType of ["dependencies", "devDependencies", "peerDependencies"]) {
    if (pkg[depType]) {
      for (const name of Object.keys(pkg[depType])) {
        if (INTERNAL_PACKAGES.includes(name)) {
          pkg[depType][name] = `^${version}`;
        }
      }
    }
  }

  writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  ✓ ${pkg.name}@${version}`);
}

console.log("\nVersion sync complete!");
