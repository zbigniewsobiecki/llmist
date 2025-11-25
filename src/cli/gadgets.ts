import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { BaseGadget } from "../gadgets/gadget.js";

/**
 * Function type for importing modules dynamically.
 */
export type GadgetImportFunction = (specifier: string) => Promise<unknown>;

const PATH_PREFIXES = [".", "/", "~"];

/**
 * Type guard to check if a value is a Gadget constructor.
 *
 * @param value - Value to check
 * @returns True if value is a Gadget constructor
 */
function isGadgetConstructor(value: unknown): value is new () => BaseGadget {
  if (typeof value !== "function") {
    return false;
  }

  const prototype = value.prototype as unknown;
  return Boolean(prototype) && prototype instanceof BaseGadget;
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
export function extractGadgetsFromModule(moduleExports: unknown): BaseGadget[] {
  const results: BaseGadget[] = [];
  const visited = new Set<unknown>();

  const visit = (value: unknown) => {
    if (value === undefined || value === null) {
      return;
    }

    if (visited.has(value)) {
      return;
    }
    visited.add(value);

    if (value instanceof BaseGadget) {
      results.push(value);
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
 * Loads gadgets from one or more file paths or npm module names.
 * Resolves paths, imports modules, and extracts gadgets.
 *
 * @param specifiers - Array of gadget specifiers (file paths or module names)
 * @param cwd - Current working directory for resolving relative paths
 * @param importer - Function to dynamically import modules (default: native import)
 * @returns Array of loaded Gadget instances
 * @throws Error if module fails to load, contains no gadgets, or initialization fails
 */
export async function loadGadgets(
  specifiers: string[],
  cwd: string,
  importer: GadgetImportFunction = (specifier) => import(specifier),
): Promise<BaseGadget[]> {
  const gadgets: BaseGadget[] = [];

  for (const specifier of specifiers) {
    const resolved = resolveGadgetSpecifier(specifier, cwd);
    let exports: unknown;
    try {
      exports = await importer(resolved);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load gadget module '${specifier}': ${message}`);
    }

    let extracted: BaseGadget[];
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
