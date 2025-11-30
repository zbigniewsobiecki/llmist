import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { LLMMessage } from "../core/messages.js";

/**
 * Default directory for LLM debug logs.
 */
export const DEFAULT_LLM_LOG_DIR = join(homedir(), ".llmist", "logs");

/**
 * Resolves the log directory from a boolean or string option.
 * - true: use default directory with subdir
 * - string: use the provided path
 * - undefined/false: disabled
 */
export function resolveLogDir(option: string | boolean | undefined, subdir: string): string | undefined {
  if (option === true) {
    return join(DEFAULT_LLM_LOG_DIR, subdir);
  }
  if (typeof option === "string") {
    return option;
  }
  return undefined;
}

/**
 * Formats LLM messages as plain text for debugging.
 */
export function formatLlmRequest(messages: LLMMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    lines.push(`=== ${msg.role.toUpperCase()} ===`);
    lines.push(msg.content ?? "");
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Writes a debug log file, creating the directory if needed.
 */
export async function writeLogFile(dir: string, filename: string, content: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), content, "utf-8");
}
