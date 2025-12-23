import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { extractMessageText, type LLMMessage } from "llmist";

/**
 * Formats LLM messages as plain text for debugging.
 */
export function formatLlmRequest(messages: LLMMessage[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    lines.push(`=== ${msg.role.toUpperCase()} ===`);
    // Handle undefined content (for incomplete/malformed messages)
    lines.push(msg.content ? extractMessageText(msg.content) : "");
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
 * Formats a call number as a zero-padded 4-digit string.
 * E.g., 1 → "0001", 42 → "0042"
 */
export function formatCallNumber(n: number): string {
  return n.toString().padStart(4, "0");
}
