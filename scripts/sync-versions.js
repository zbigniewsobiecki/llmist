#!/usr/bin/env node
/**
 * Syncs version across all packages in the monorepo.
 * Used by semantic-release before npm publish.
 *
 * This script:
 * 1. Reads the version from root package.json
 * 2. Updates all package versions to match
 * 3. Replaces `workspace:*` with actual version for publishing
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PACKAGES = ["packages/llmist", "packages/cli", "packages/testing"];

// Get version from llmist package.json (source of truth)
const llmistPkg = JSON.parse(readFileSync(join(ROOT, "packages/llmist/package.json"), "utf8"));
const version = llmistPkg.version;

console.log(`Syncing version ${version} across packages...`);

for (const pkgPath of PACKAGES) {
  const pkgJsonPath = join(ROOT, pkgPath, "package.json");
  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));

  // Update version
  pkg.version = version;

  // Replace workspace:* with actual version in dependencies
  for (const depType of ["dependencies", "devDependencies", "peerDependencies"]) {
    if (pkg[depType]) {
      for (const [name, ver] of Object.entries(pkg[depType])) {
        if (ver === "workspace:*") {
          pkg[depType][name] = `^${version}`;
        }
      }
    }
  }

  writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  ✓ ${pkg.name}@${version}`);
}

console.log("\nVersion sync complete!");
