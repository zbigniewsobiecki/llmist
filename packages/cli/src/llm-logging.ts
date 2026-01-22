/**
 * LLM logging utilities for debugging.
 *
 * Note: The core formatting functions (formatLlmRequest, formatCallNumber) have been
 * moved to the llmist core library. This file re-exports them for backward compatibility
 * and provides CLI-specific utilities like writeLogFile.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Re-export from core library for backward compatibility
export { formatCallNumber, formatLlmRequest } from "llmist";

/**
 * Writes a debug log file, creating the directory if needed.
 */
export async function writeLogFile(dir: string, filename: string, content: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), content, "utf-8");
}
