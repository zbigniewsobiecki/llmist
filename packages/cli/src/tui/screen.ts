/**
 * TUI screen lifecycle management.
 *
 * Handles creation, rendering, and cleanup of the blessed Screen instance.
 * Ensures proper terminal restoration on exit.
 */

import { NodeRuntime, Screen, setRuntime } from "@unblessed/node";
import type { TUIScreenContext } from "./types.js";

// Initialize the Node.js runtime (required before any blessed widgets can be created)
let runtimeInitialized = false;

function ensureRuntimeInitialized(): void {
  if (!runtimeInitialized) {
    setRuntime(new NodeRuntime());
    runtimeInitialized = true;
  }
}

/** Default render debounce interval in milliseconds */
const RENDER_DEBOUNCE_MS = 16; // ~60fps

/**
 * Creates and configures a blessed Screen with proper lifecycle management.
 *
 * @param options - Screen configuration options
 * @returns Screen context with lifecycle methods
 */
export function createScreen(options?: {
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
  title?: string;
}): TUIScreenContext {
  // Ensure runtime is initialized before creating any blessed widgets
  ensureRuntimeInitialized();

  const screen = new Screen({
    smartCSR: true, // Smart cursor rendering for better performance
    fullUnicode: true, // Support emoji and extended characters
    title: options?.title ?? "llmist",
    input: options?.stdin,
    output: options?.stdout,
    // Capture all keyboard input
    grabKeys: true,
    // Use alternate screen buffer (restores on exit)
    useBCE: true,
  });

  // Enable bracketed paste mode - terminal wraps pasted content with escape sequences
  // Start: \x1b[200~  End: \x1b[201~
  // This allows reliable paste detection across all terminal emulators
  screen.program.write("\x1b[?2004h");

  let isDestroyed = false;
  let renderPending = false;
  let renderTimeout: ReturnType<typeof setTimeout> | null = null;

  // Debounced render function to avoid excessive redraws
  // Uses trailing-edge debounce: captures latest state before rendering
  const requestRender = () => {
    if (isDestroyed) return;

    // If a render is already pending, it will pick up the latest state
    // when it fires, so we don't need to schedule another one
    if (renderPending) return;

    renderPending = true;
    renderTimeout = setTimeout(() => {
      renderPending = false;
      if (!isDestroyed) {
        screen.render();
      }
    }, RENDER_DEBOUNCE_MS);
  };

  // Immediate render for time-sensitive updates (like streaming tokens)
  const renderNow = () => {
    if (isDestroyed) return;

    // Cancel any pending debounced render
    if (renderTimeout) {
      clearTimeout(renderTimeout);
      renderTimeout = null;
      renderPending = false;
    }

    screen.render();
  };

  // Cleanup function
  const destroy = () => {
    if (isDestroyed) return;
    isDestroyed = true;

    // Clear any pending render
    if (renderTimeout) {
      clearTimeout(renderTimeout);
      renderTimeout = null;
    }

    // Disable bracketed paste mode before restoring terminal
    screen.program.write("\x1b[?2004l");

    // Destroy screen (restores terminal)
    screen.destroy();

    // Ensure cursor is visible
    process.stdout.write("\x1b[?25h");
  };

  // Handle process signals for graceful cleanup
  const sigintHandler = () => {
    destroy();
    process.exit(130); // SIGINT convention
  };

  const sigtermHandler = () => {
    destroy();
    process.exit(143); // SIGTERM convention
  };

  process.once("SIGINT", sigintHandler);
  process.once("SIGTERM", sigtermHandler);

  // Also handle uncaught exceptions to restore terminal
  process.once("uncaughtException", (err) => {
    destroy();
    console.error("Uncaught exception:", err);
    process.exit(1);
  });

  return {
    screen,
    requestRender,
    renderNow,
    destroy,
  };
}
