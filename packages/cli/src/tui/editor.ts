/**
 * External editor integration for multiline input.
 *
 * Opens the user's $EDITOR (like git does for commit messages)
 * to allow full-featured multiline editing.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Open the user's preferred editor with optional initial content.
 * Uses spawnSync to completely block until editor exits.
 *
 * @param initialContent - Content to pre-populate in the editor
 * @returns The edited content, or null if user cancelled
 */
export function openEditorSync(initialContent = ""): string | null {
  // Prefer $VISUAL, then $EDITOR, then fall back to vi
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  const tmpFile = join(tmpdir(), `llmist-input-${Date.now()}.txt`);

  // Write initial content to temp file
  writeFileSync(tmpFile, initialContent, "utf-8");

  try {
    // Parse editor command (handles "code --wait" style commands)
    const parts = editor.split(/\s+/);
    const cmd = parts[0];
    const args = [...parts.slice(1), tmpFile];

    // Use spawnSync to block completely - this prevents blessed from interfering
    const result = spawnSync(cmd, args, {
      stdio: "inherit", // Connect to user's terminal
      shell: false,
    });

    if (result.error) {
      // Editor failed to spawn
      try {
        unlinkSync(tmpFile);
      } catch {
        // Ignore cleanup errors
      }
      return null;
    }

    if (result.status === 0) {
      // Editor exited successfully - read content
      const content = readFileSync(tmpFile, "utf-8");
      unlinkSync(tmpFile);
      const trimmed = content.trim();
      return trimmed || null; // Return null for empty content
    } else {
      // Non-zero exit (e.g., :q! in vim, Ctrl+C)
      unlinkSync(tmpFile);
      return null;
    }
  } catch {
    // Any error - cleanup and return null
    try {
      unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
    return null;
  }
}
