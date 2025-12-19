/**
 * External gadget loader for llmist CLI.
 *
 * Supports loading gadgets from:
 * - npm packages (with auto-installation)
 * - git URLs
 * - Manifest-based presets and individual gadget selection
 *
 * @module cli/external-gadgets
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";

import type { AbstractGadget } from "llmist";
import { extractGadgetsFromModule } from "./gadgets.js";

/**
 * Cache directory for external gadget packages.
 */
const CACHE_DIR = path.join(os.homedir(), ".llmist", "gadget-cache");

/**
 * Parsed gadget specifier.
 */
export interface GadgetSpecifier {
  type: "npm" | "git";
  /** Package name (npm) or URL (git) */
  package: string;
  /** Version or git ref */
  version?: string;
  /** Preset name (e.g., "minimal", "readonly") */
  preset?: string;
  /** Individual gadget name (e.g., "Navigate") */
  gadgetName?: string;
}

/**
 * Manifest structure from package.json llmist field.
 */
export interface LlmistManifest {
  /** Entry point for all gadgets */
  gadgets?: string;
  /** Factory function entry point */
  factory?: string;
  /** Subagent definitions */
  subagents?: Record<
    string,
    {
      entryPoint: string;
      export: string;
      description?: string;
      uses?: string[];
      defaultModel?: string;
      maxIterations?: number;
    }
  >;
  /** Preset definitions */
  presets?: Record<string, string[] | "*">;
  /** Session factory info */
  session?: {
    factory: string;
    type: string;
  };
}

/**
 * Check if a specifier is an external package (npm or git).
 */
export function isExternalPackageSpecifier(specifier: string): boolean {
  // npm package patterns
  if (/^@?[a-z0-9][\w.-]*(?:@[\w.-]+)?(?::[a-z]+)?(?:\/\w+)?$/i.test(specifier)) {
    return true;
  }
  // git URL patterns
  if (specifier.startsWith("git+")) {
    return true;
  }
  return false;
}

/**
 * Parse a gadget specifier into its components.
 *
 * Supported formats:
 * - `webasto` - npm package, all gadgets
 * - `webasto@2.0.0` - npm package with version
 * - `webasto:minimal` - npm package with preset
 * - `webasto/Navigate` - npm package with specific gadget
 * - `webasto@2.0.0:minimal` - all combined
 * - `git+https://github.com/user/repo` - git URL
 * - `git+https://github.com/user/repo#v1.0.0` - git URL with ref
 * - `git+https://github.com/user/repo#v1.0.0:minimal` - git URL with ref and preset
 * - `git+https://github.com/user/repo:minimal` - git URL with preset (no ref)
 */
export function parseGadgetSpecifier(specifier: string): GadgetSpecifier | null {
  // Git URL: git+URL[#ref][:preset]
  if (specifier.startsWith("git+")) {
    const url = specifier.slice(4);
    let baseUrl: string;
    let ref: string | undefined;
    let preset: string | undefined;

    if (url.includes("#")) {
      const hashIndex = url.indexOf("#");
      baseUrl = url.slice(0, hashIndex);
      const refAndPreset = url.slice(hashIndex + 1);

      if (refAndPreset.includes(":")) {
        const colonIndex = refAndPreset.indexOf(":");
        ref = refAndPreset.slice(0, colonIndex);
        preset = refAndPreset.slice(colonIndex + 1);
      } else {
        ref = refAndPreset;
      }
    } else {
      // Check for :preset without #ref (but be careful not to match https: port)
      // The preset must come after the .git extension or after a /
      const gitExtIndex = url.indexOf(".git");
      if (gitExtIndex !== -1) {
        const afterGit = url.slice(gitExtIndex + 4);
        if (afterGit.startsWith(":")) {
          baseUrl = url.slice(0, gitExtIndex + 4);
          preset = afterGit.slice(1);
        } else {
          baseUrl = url;
        }
      } else {
        baseUrl = url;
      }
    }

    return {
      type: "git",
      package: baseUrl,
      version: ref,
      preset,
    };
  }

  // npm package with optional version, preset, and gadget name
  // Format: package[@version][:preset][/gadgetName]
  const npmMatch = specifier.match(
    /^(@?[a-z0-9][\w.-]*)(?:@([\w.-]+))?(?::([a-z]+))?(?:\/(\w+))?$/i,
  );

  if (npmMatch) {
    const [, pkg, version, preset, gadgetName] = npmMatch;
    return {
      type: "npm",
      package: pkg,
      version,
      preset,
      gadgetName,
    };
  }

  return null;
}

/**
 * Get the cache directory for a package.
 */
function getCacheDir(spec: GadgetSpecifier): string {
  const versionSuffix = spec.version ? `@${spec.version}` : "@latest";

  if (spec.type === "npm") {
    return path.join(CACHE_DIR, "npm", `${spec.package}${versionSuffix}`);
  }
  // git: sanitize URL for filesystem
  const sanitizedUrl = spec.package.replace(/[/:]/g, "-").replace(/^-+|-+$/g, "");
  return path.join(CACHE_DIR, "git", `${sanitizedUrl}${versionSuffix}`);
}

/**
 * Check if a package is already cached and up to date.
 */
function isCached(cacheDir: string): boolean {
  const packageJsonPath = path.join(cacheDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return false;
  }

  // Always check if entry point exists (regardless of build script)
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const entryPoint = packageJson.llmist?.gadgets || "./dist/index.js";
    const entryPointPath = path.join(cacheDir, entryPoint);
    if (!fs.existsSync(entryPointPath)) {
      return false; // Entry point missing, needs install/build
    }
  } catch {
    // If we can't parse package.json, assume not cached
    return false;
  }

  return true;
}

/**
 * Install an npm package to the cache directory.
 */
async function installNpmPackage(spec: GadgetSpecifier, cacheDir: string): Promise<void> {
  // Create cache directory
  fs.mkdirSync(cacheDir, { recursive: true });

  // Create minimal package.json
  const packageJson = {
    name: "llmist-gadget-cache",
    private: true,
    type: "module",
  };
  fs.writeFileSync(path.join(cacheDir, "package.json"), JSON.stringify(packageJson, null, 2));

  // Install the package
  const packageSpec = spec.version ? `${spec.package}@${spec.version}` : spec.package;

  try {
    // Use bun add for isolated install (works in Docker containers that only have bun)
    execSync(`bun add "${packageSpec}"`, {
      stdio: "pipe",
      cwd: cacheDir,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to install npm package '${packageSpec}': ${message}`);
  }
}

/**
 * Clone/fetch a git repository to the cache directory.
 */
async function installGitPackage(spec: GadgetSpecifier, cacheDir: string): Promise<void> {
  // Create parent directory
  fs.mkdirSync(path.dirname(cacheDir), { recursive: true });

  if (fs.existsSync(cacheDir)) {
    // Update existing repo
    try {
      execSync("git fetch", { cwd: cacheDir, stdio: "pipe" });
      if (spec.version) {
        execSync(`git checkout ${spec.version}`, { cwd: cacheDir, stdio: "pipe" });
      }
    } catch (error) {
      // If update fails, remove and re-clone
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  }

  if (!fs.existsSync(cacheDir)) {
    try {
      const cloneCmd = spec.version
        ? `git clone --branch ${spec.version} "${spec.package}" "${cacheDir}"`
        : `git clone "${spec.package}" "${cacheDir}"`;
      execSync(cloneCmd, { stdio: "pipe" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to clone git repository '${spec.package}': ${message}`);
    }

    // Install dependencies and build
    if (fs.existsSync(path.join(cacheDir, "package.json"))) {
      try {
        execSync("bun install", { cwd: cacheDir, stdio: "inherit" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to install dependencies for '${spec.package}': ${message}`);
      }

      // Run build if available (git packages need to be built)
      const packageJson = JSON.parse(fs.readFileSync(path.join(cacheDir, "package.json"), "utf-8"));
      if (packageJson.scripts?.build) {
        try {
          execSync("bun run build", { cwd: cacheDir, stdio: "inherit" });
        } catch (error) {
          // Build may fail (e.g., TypeScript errors in test files) but the main bundle
          // may still be created. Check if the entry point exists before failing.
          const entryPoint = packageJson.llmist?.gadgets || "./dist/index.js";
          const entryPointPath = path.join(cacheDir, entryPoint);
          if (!fs.existsSync(entryPointPath)) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Failed to build package '${spec.package}': ${message}`);
          }
          // Entry point exists, continue despite build errors
        }
      }
    }
  }
}

/**
 * Read the llmist manifest from a package.
 */
function readManifest(packageDir: string): LlmistManifest | null {
  const packageJsonPath = path.join(packageDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    return packageJson.llmist || null;
  } catch {
    return null;
  }
}

/**
 * Get the path to the installed package.
 */
function getPackagePath(cacheDir: string, packageName: string): string {
  // For npm packages, the actual package is in node_modules
  const nodeModulesPath = path.join(cacheDir, "node_modules", packageName);
  if (fs.existsSync(nodeModulesPath)) {
    return nodeModulesPath;
  }
  // For git packages, it's the cache dir itself
  return cacheDir;
}

/**
 * Load gadgets from an external package.
 *
 * @param specifier - External package specifier
 * @param forceInstall - Force reinstall even if cached
 * @returns Array of loaded gadgets
 */
export async function loadExternalGadgets(
  specifier: string,
  forceInstall = false,
): Promise<AbstractGadget[]> {
  const spec = parseGadgetSpecifier(specifier);
  if (!spec) {
    throw new Error(`Invalid external package specifier: ${specifier}`);
  }

  const cacheDir = getCacheDir(spec);

  // Install if not cached or force install
  if (!isCached(cacheDir) || forceInstall) {
    if (spec.type === "npm") {
      await installNpmPackage(spec, cacheDir);
    } else {
      await installGitPackage(spec, cacheDir);
    }
  }

  // Get the actual package path
  const packagePath = getPackagePath(cacheDir, spec.package);

  // Read manifest
  const manifest = readManifest(packagePath);

  // Determine what to load
  let entryPoint: string;
  let gadgetNames: string[] | null = null;

  if (spec.gadgetName) {
    // Single gadget requested
    gadgetNames = [spec.gadgetName];
    // Check if it's a subagent
    if (manifest?.subagents?.[spec.gadgetName]) {
      entryPoint = manifest.subagents[spec.gadgetName].entryPoint;
    } else {
      entryPoint = manifest?.gadgets || "./dist/index.js";
    }
  } else if (spec.preset) {
    // Preset requested
    if (!manifest?.presets?.[spec.preset]) {
      throw new Error(`Unknown preset '${spec.preset}' in package '${spec.package}'`);
    }
    const preset = manifest.presets[spec.preset];
    if (preset === "*") {
      // All gadgets
      gadgetNames = null;
    } else {
      gadgetNames = preset;
    }
    entryPoint = manifest?.gadgets || "./dist/index.js";
  } else {
    // All gadgets (default)
    entryPoint = manifest?.gadgets || "./dist/index.js";
  }

  // Resolve entry point
  const resolvedEntryPoint = path.resolve(packagePath, entryPoint);
  if (!fs.existsSync(resolvedEntryPoint)) {
    throw new Error(
      `Entry point not found: ${resolvedEntryPoint}. ` +
        "Make sure the package is built (run 'npm run build' in the package directory).",
    );
  }

  // Import the module
  const moduleUrl = pathToFileURL(resolvedEntryPoint).href;
  let exports: unknown;
  try {
    exports = await import(moduleUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to import '${specifier}': ${message}`);
  }

  let gadgets: AbstractGadget[] = [];

  // Check if this is a factory-based package
  if (manifest?.factory) {
    const exportsObj = exports as Record<string, unknown>;

    // Try factory functions in order of specificity
    if (spec.preset && typeof exportsObj.createGadgetsByPreset === "function") {
      // Use preset-specific factory
      const result = await (exportsObj.createGadgetsByPreset as (preset: string) => Promise<unknown>)(
        spec.preset,
      );
      gadgets = extractGadgetsFromModule(result);
      // Clear gadgetNames since factory already handled the preset filtering
      gadgetNames = null;
    } else if (gadgetNames && typeof exportsObj.createGadgetsByName === "function") {
      // Use name-specific factory
      const result = await (exportsObj.createGadgetsByName as (names: string[]) => Promise<unknown>)(
        gadgetNames,
      );
      gadgets = extractGadgetsFromModule(result);
      // Clear gadgetNames since factory already filtered
      gadgetNames = null;
    } else {
      // Try common factory function names
      const factoryNames = [
        "createGadgets",
        "createDhalsimGadgets",
        "createAllGadgets",
        "gadgets",
        "default",
      ];

      for (const name of factoryNames) {
        if (typeof exportsObj[name] === "function") {
          const result = await (exportsObj[name] as () => Promise<unknown>)();
          gadgets = extractGadgetsFromModule(result);
          if (gadgets.length > 0) break;
        }
      }
    }
  }

  // Fall back to extracting gadgets directly from exports
  if (gadgets.length === 0) {
    gadgets = extractGadgetsFromModule(exports);
  }

  // Filter by name if specific gadgets requested
  if (gadgetNames) {
    const gadgetSet = new Set(gadgetNames.map((n) => n.toLowerCase()));
    gadgets = gadgets.filter((g) => {
      const name = g.name?.toLowerCase() || "";
      return gadgetSet.has(name);
    });

    // Check if all requested gadgets were found
    const foundNames = new Set(gadgets.map((g) => g.name?.toLowerCase() || ""));
    for (const requested of gadgetNames) {
      if (!foundNames.has(requested.toLowerCase())) {
        throw new Error(`Gadget '${requested}' not found in package '${spec.package}'`);
      }
    }
  }

  if (gadgets.length === 0) {
    throw new Error(`No gadgets found in package '${spec.package}'`);
  }

  return gadgets;
}

/**
 * List available gadgets from an external package.
 *
 * @param specifier - External package specifier
 * @returns Object with gadget info
 */
export async function listExternalGadgets(specifier: string): Promise<{
  packageName: string;
  gadgets: Array<{ name: string; description: string }>;
  subagents: Array<{ name: string; description: string }>;
  presets: string[];
}> {
  const spec = parseGadgetSpecifier(specifier);
  if (!spec) {
    throw new Error(`Invalid external package specifier: ${specifier}`);
  }

  const cacheDir = getCacheDir(spec);

  // Install if not cached
  if (!isCached(cacheDir)) {
    if (spec.type === "npm") {
      await installNpmPackage(spec, cacheDir);
    } else {
      await installGitPackage(spec, cacheDir);
    }
  }

  const packagePath = getPackagePath(cacheDir, spec.package);
  const manifest = readManifest(packagePath);

  // Load gadgets to get their info
  const entryPoint = manifest?.gadgets || "./dist/index.js";
  const resolvedEntryPoint = path.resolve(packagePath, entryPoint);

  let gadgetInfo: Array<{ name: string; description: string }> = [];

  if (fs.existsSync(resolvedEntryPoint)) {
    try {
      const moduleUrl = pathToFileURL(resolvedEntryPoint).href;
      const exports = await import(moduleUrl);
      const gadgets = extractGadgetsFromModule(exports);
      gadgetInfo = gadgets.map((g) => ({
        name: g.name || "unnamed",
        description: g.description || "",
      }));
    } catch {
      // Ignore import errors for listing
    }
  }

  // Get subagent info from manifest
  const subagentInfo = Object.entries(manifest?.subagents || {}).map(([name, info]) => ({
    name,
    description: info.description || "",
  }));

  return {
    packageName: spec.package,
    gadgets: gadgetInfo,
    subagents: subagentInfo,
    presets: Object.keys(manifest?.presets || {}),
  };
}
