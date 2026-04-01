/**
 * Built-in gadgets registry.
 * These gadgets can be referenced by name (e.g., "ListDirectory") or
 * with the explicit "builtin:" prefix (e.g., "builtin:ListDirectory").
 */

import type { AbstractGadget } from "llmist";
import { deleteFile } from "./filesystem/delete-file.js";
import { editFile } from "./filesystem/edit-file.js";
import { listDirectory } from "./filesystem/list-directory.js";
import { readFile } from "./filesystem/read-file.js";
import { writeFile } from "./filesystem/write-file.js";
import { readImage } from "./read-image.js";
import { runCommand } from "./run-command.js";
// Note: textToSpeech is a default instance with no config.
// Use createTextToSpeech(config) for custom configuration from cli.toml.
import { createTextToSpeech, textToSpeech } from "./text-to-speech.js";

/**
 * Registry mapping gadget names to their instances.
 * Names are case-sensitive and match the gadget's declared name.
 */
export const builtinGadgetRegistry: Record<string, AbstractGadget> = {
  ListDirectory: listDirectory,
  ReadFile: readFile,
  ReadImage: readImage,
  WriteFile: writeFile,
  EditFile: editFile,
  DeleteFile: deleteFile,
  RunCommand: runCommand,
  TextToSpeech: textToSpeech,
};

/**
 * Gets a built-in gadget by name.
 *
 * @param name - The gadget name (e.g., "ListDirectory")
 * @returns The gadget instance, or undefined if not found
 */
export function getBuiltinGadget(name: string): AbstractGadget | undefined {
  return builtinGadgetRegistry[name];
}

/**
 * Checks if a name corresponds to a built-in gadget.
 *
 * @param name - The name to check
 * @returns True if the name is a registered built-in gadget
 */
export function isBuiltinGadgetName(name: string): boolean {
  return name in builtinGadgetRegistry;
}

/**
 * Gets all available built-in gadget names.
 *
 * @returns Array of built-in gadget names
 */
export function getBuiltinGadgetNames(): string[] {
  return Object.keys(builtinGadgetRegistry);
}

// Re-export individual gadgets for direct imports
export {
  listDirectory,
  readFile,
  readImage,
  writeFile,
  editFile,
  deleteFile,
  runCommand,
  textToSpeech,
  createTextToSpeech,
};
