import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { extractText, type LLMMessage } from "../core/messages.js";

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
    // Handle undefined content (for incomplete/malformed messages)
    lines.push(msg.content ? extractText(msg.content) : "");
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

/**
 * Formats a timestamp for session directory naming.
 * Returns format: "YYYY-MM-DD_HH-MM-SS" (e.g., "2025-12-09_14-30-45")
 */
export function formatSessionTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

/**
 * Creates a session directory with a timestamped name.
 * Returns the full path to the created directory, or undefined if creation fails.
 */
export async function createSessionDir(baseDir: string): Promise<string | undefined> {
  const timestamp = formatSessionTimestamp();
  const sessionDir = join(baseDir, timestamp);
  try {
    await mkdir(sessionDir, { recursive: true });
    return sessionDir;
  } catch (error) {
    console.warn(`[llmist] Failed to create log session directory: ${sessionDir}`, error);
    return undefined;
  }
}

/**
 * Formats a call number as a zero-padded 4-digit string.
 * E.g., 1 → "0001", 42 → "0042"
 */
export function formatCallNumber(n: number): string {
  return n.toString().padStart(4, "0");
}
