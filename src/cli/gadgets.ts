import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { AbstractGadget } from "../gadgets/gadget.js";
import { getBuiltinGadget, isBuiltinGadgetName } from "./builtins/index.js";

/**
 * Function type for importing modules dynamically.
 */
export type GadgetImportFunction = (specifier: string) => Promise<unknown>;

const PATH_PREFIXES = [".", "/", "~"];
const BUILTIN_PREFIX = "builtin:";

/**
 * Duck-type check if a value looks like a Gadget instance.
 * This avoids instanceof issues when gadgets are loaded from external files
 * that import from the 'llmist' npm package (different class instance).
 */
function isGadgetLike(value: unknown): value is AbstractGadget {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.execute === "function" &&
    typeof obj.description === "string" &&
    ("parameterSchema" in obj || "schema" in obj)
  );
}

/**
 * Type guard to check if a value is a Gadget constructor.
 *
 * @param value - Value to check
 * @returns True if value is a Gadget constructor
 */
function isGadgetConstructor(value: unknown): value is new () => AbstractGadget {
  if (typeof value !== "function") {
    return false;
  }

  const prototype = value.prototype as unknown;
  // Use duck typing for prototype check too
  return Boolean(prototype) && (prototype instanceof AbstractGadget || isGadgetLike(prototype));
}

/**
 * Expands ~ to the user's home directory.
 *
 * @param input - Path that may start with ~
 * @returns Expanded path with HOME directory
 */
function expandHomePath(input: string): string {
  if (!input.startsWith("~")) {
    return input;
  }

  const home = process.env.HOME;
  if (!home) {
    return input;
  }

  return path.join(home, input.slice(1));
}

/**
 * Determines if a specifier is a file path vs npm module name.
 * File paths start with ., /, ~ or contain path separators.
 *
 * @param specifier - Module specifier to check
 * @returns True if specifier represents a file path
 */
function isFileLikeSpecifier(specifier: string): boolean {
  return (
    PATH_PREFIXES.some((prefix) => specifier.startsWith(prefix)) || specifier.includes(path.sep)
  );
}

/**
 * Attempts to resolve a specifier as a built-in gadget.
 * Handles both explicit "builtin:" prefix and bare names that match built-in gadgets.
 *
 * @param specifier - The gadget specifier to check
 * @returns The built-in gadget if found, null otherwise
 * @throws Error if "builtin:" prefix is used but gadget doesn't exist
 */
export function tryResolveBuiltin(specifier: string): AbstractGadget | null {
  // Handle explicit builtin: prefix
  if (specifier.startsWith(BUILTIN_PREFIX)) {
    const name = specifier.slice(BUILTIN_PREFIX.length);
    const gadget = getBuiltinGadget(name);
    if (!gadget) {
      throw new Error(
        `Unknown builtin gadget: ${name}. Available builtins: ListDirectory, ReadFile, WriteFile, EditFile, RunCommand`,
      );
    }
    return gadget;
  }

  // For non-file-path specifiers, check builtins first
  if (!isFileLikeSpecifier(specifier) && isBuiltinGadgetName(specifier)) {
    return getBuiltinGadget(specifier)!;
  }

  return null;
}

/**
 * Resolves a gadget specifier to either a file URL or npm module name.
 * File paths are resolved relative to cwd and converted to file:// URLs.
 *
 * @param specifier - Original gadget specifier (file path or module name)
 * @param cwd - Current working directory for resolving relative paths
 * @returns Resolved specifier (file:// URL for files, module name for packages)
 * @throws Error if file path doesn't exist
 */
export function resolveGadgetSpecifier(specifier: string, cwd: string): string {
  if (!isFileLikeSpecifier(specifier)) {
    return specifier;
  }

  const expanded = expandHomePath(specifier);
  const resolvedPath = path.resolve(cwd, expanded);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Gadget module not found at ${resolvedPath}`);
  }
  return pathToFileURL(resolvedPath).href;
}

/**
 * Recursively extracts all Gadget instances and classes from a module's exports.
 * Searches default export, named exports, nested objects, and arrays.
 * Automatically instantiates Gadget classes.
 *
 * @param moduleExports - Module exports object to search
 * @returns Array of Gadget instances found in exports
 */
export function extractGadgetsFromModule(moduleExports: unknown): AbstractGadget[] {
  const results: AbstractGadget[] = [];
  const visited = new Set<unknown>();

  const visit = (value: unknown) => {
    if (value === undefined || value === null) {
      return;
    }

    if (visited.has(value)) {
      return;
    }
    visited.add(value);

    // Use duck typing to handle gadgets from external packages
    if (value instanceof AbstractGadget || isGadgetLike(value)) {
      results.push(value as AbstractGadget);
      return;
    }

    if (isGadgetConstructor(value)) {
      results.push(new value());
      return;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        visit(entry);
      }
      return;
    }

    if (typeof value === "object") {
      for (const entry of Object.values(value as Record<string, unknown>)) {
        visit(entry);
      }
    }
  };

  visit(moduleExports);
  return results;
}

/**
 * Loads gadgets from one or more specifiers.
 * Supports built-in gadgets (by name or "builtin:" prefix), file paths, and npm module names.
 *
 * Resolution order:
 * 1. "builtin:Name" - explicit built-in lookup (error if not found)
 * 2. Bare "Name" without path chars - check built-in registry first
 * 3. File paths (starting with ., /, ~) - resolve and import
 * 4. npm module names - dynamic import
 *
 * @param specifiers - Array of gadget specifiers
 * @param cwd - Current working directory for resolving relative paths
 * @param importer - Function to dynamically import modules (default: native import)
 * @returns Array of loaded Gadget instances
 * @throws Error if module fails to load, contains no gadgets, or initialization fails
 */
export async function loadGadgets(
  specifiers: string[],
  cwd: string,
  importer: GadgetImportFunction = (specifier) => import(specifier),
): Promise<AbstractGadget[]> {
  const gadgets: AbstractGadget[] = [];

  for (const specifier of specifiers) {
    // Try builtin resolution first
    const builtin = tryResolveBuiltin(specifier);
    if (builtin) {
      gadgets.push(builtin);
      continue;
    }

    // Fall back to file/npm resolution
    const resolved = resolveGadgetSpecifier(specifier, cwd);
    let exports: unknown;
    try {
      exports = await importer(resolved);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load gadget module '${specifier}': ${message}`);
    }

    let extracted: AbstractGadget[];
    try {
      extracted = extractGadgetsFromModule(exports);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to initialize gadgets from module '${specifier}': ${message}`);
    }
    if (extracted.length === 0) {
      throw new Error(`Module '${specifier}' does not export any Gadget instances.`);
    }
    gadgets.push(...extracted);
  }

  return gadgets;
}
