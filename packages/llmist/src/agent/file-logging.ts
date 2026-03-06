/**
 * File-based logging for LLM requests and responses.
 *
 * Provides hooks to write raw LLM requests and responses to files for debugging,
 * auditing, and analysis. Supports both programmatic configuration and
 * zero-code activation via environment variables.
 *
 * ## Programmatic Usage
 *
 * ```typescript
 * import { LLMist, HookPresets } from 'llmist';
 *
 * const agent = LLMist.createAgent()
 *   .withHooks(HookPresets.fileLogging({
 *     directory: './logs/session-001'
 *   }))
 *   .ask("Hello");
 *
 * // Creates: ./logs/session-001/0001.request
 * //          ./logs/session-001/0001.response
 * ```
 *
 * ## Environment Variable
 *
 * Set `LLMIST_LOG_RAW_DIRECTORY` to enable logging without code changes:
 *
 * ```bash
 * export LLMIST_LOG_RAW_DIRECTORY="/tmp/llm-debug"
 * node my-app.js
 * ```
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { extractMessageText, type LLMMessage } from "../core/messages.js";
import type { AgentHooks, SubagentContext } from "./hooks.js";

// ============================================================================
// FILE LOGGING STATE MANAGEMENT
// ============================================================================

/**
 * State container for file logging session.
 * Encapsulates all mutable state to enable session isolation and proper
 * handling of concurrent subagents.
 *
 * @remarks
 * Using a state object instead of module-level globals provides:
 * - **Session isolation**: Multiple agent sessions don't interfere with each other
 * - **Testability**: Tests can inject fresh state without needing to reset globals
 * - **Concurrent subagent support**: Context-based keys prevent race conditions
 */
export interface FileLoggingState {
  /** Counter per directory path (normalized) */
  readonly counters: Map<string, number>;

  /**
   * Subagent context key -> assigned directory path.
   * Key format: `${parentDir}:${parentGadgetInvocationId}`
   */
  readonly subagentDirectories: Map<string, string>;

  /**
   * Context key -> active directory for that execution context.
   * Key format: `${parentGadgetInvocationId}:${depth}` (or "root:0" for main agent)
   *
   * This replaces the previous depth-only keying which caused race conditions
   * when multiple subagents at the same depth ran concurrently.
   */
  readonly activeDirectoryByContext: Map<string, string>;
}

/**
 * Creates a fresh file logging state container.
 *
 * Use this to create isolated state for testing or when running multiple
 * independent agent sessions that shouldn't share counters.
 *
 * @example
 * ```typescript
 * // For testing with isolated state:
 * const state = createFileLoggingState();
 * const hooks = createFileLoggingHooks({ directory: './logs' }, state);
 *
 * // For production (uses default shared state):
 * const hooks = createFileLoggingHooks({ directory: './logs' });
 * ```
 */
export function createFileLoggingState(): FileLoggingState {
  return {
    counters: new Map(),
    subagentDirectories: new Map(),
    activeDirectoryByContext: new Map(),
  };
}

/**
 * Default global state for backward compatibility.
 * Created lazily on first use.
 */
let defaultState: FileLoggingState | undefined;

/**
 * Gets the default global state, creating it if needed.
 */
function getDefaultState(): FileLoggingState {
  if (!defaultState) {
    defaultState = createFileLoggingState();
  }
  return defaultState;
}

/**
 * Gets the next counter for a directory within a state container.
 */
function getNextCounter(state: FileLoggingState, directory: string): number {
  const current = state.counters.get(directory) ?? 0;
  const next = current + 1;
  state.counters.set(directory, next);
  return next;
}

/**
 * Creates a unique key for tracking active directories per execution context.
 * Uses parent invocation ID + depth to correctly handle concurrent subagents.
 *
 * @param subagentContext - Subagent context (undefined for main agent)
 * @returns Context key string
 */
function getContextKey(subagentContext?: SubagentContext): string {
  if (!subagentContext) return "root:0";
  return `${subagentContext.parentGadgetInvocationId}:${subagentContext.depth}`;
}

/**
 * Resets the default global state. For testing only.
 * @internal
 */
export function resetFileLoggingState(): void {
  defaultState = undefined;
}

/**
 * Finds the parent directory key for a nested subagent.
 *
 * For depth > 1, we need to find which depth-(N-1) directory this subagent
 * should nest under. Since SubagentContext only gives us parentGadgetInvocationId
 * (the gadget that spawned us), we search for an active directory at the parent depth.
 *
 * @param state - The file logging state
 * @param currentDepth - The current subagent depth
 * @returns The context key of the parent directory, or "root:0" if not found
 */
function findParentContextKey(state: FileLoggingState, currentDepth: number): string {
  const parentDepth = currentDepth - 1;

  // For depth 1, parent is always the root
  if (parentDepth === 0) return "root:0";

  // For deeper levels, find any active entry at parent depth
  // This works because subagents spawn sequentially within their parent context
  for (const [key, _path] of state.activeDirectoryByContext) {
    if (key.endsWith(`:${parentDepth}`)) {
      return key;
    }
  }

  return "root:0";
}

/**
 * Resolves the logging directory for a given context.
 * - Main agent: uses base directory directly
 * - Subagent: creates/reuses a numbered subdirectory inside parent's directory
 *
 * Uses context-based tracking (parentInvocationId:depth) to determine where
 * nested subagents should go. This approach handles concurrent subagents at
 * the same depth correctly, unlike depth-only keying.
 *
 * @param state - The file logging state container
 * @param baseDirectory - The root directory for logging (normalized)
 * @param counterPadding - Number of digits for zero-padding
 * @param subagentContext - Subagent context if this is a subagent call
 * @returns The resolved directory path for this agent/subagent
 */
function resolveLoggingDirectory(
  state: FileLoggingState,
  baseDirectory: string,
  counterPadding: number,
  subagentContext?: SubagentContext,
): string {
  const contextKey = getContextKey(subagentContext);

  if (!subagentContext) {
    // Main agent - register as root context
    state.activeDirectoryByContext.set(contextKey, baseDirectory);
    return baseDirectory;
  }

  const { parentGadgetInvocationId, depth } = subagentContext;

  // Find the parent directory using context-based lookup
  const parentContextKey = findParentContextKey(state, depth);
  const parentDir = state.activeDirectoryByContext.get(parentContextKey) ?? baseDirectory;

  // Check if we already assigned a directory for this specific subagent invocation
  const subagentKey = `${parentDir}:${parentGadgetInvocationId}`;
  let fullPath = state.subagentDirectories.get(subagentKey);

  if (!fullPath) {
    // First call from this subagent - assign a chronological number
    const chronoNumber = getNextCounter(state, parentDir);
    const subdirName = `${formatCallNumber(chronoNumber, counterPadding)}-${parentGadgetInvocationId}`;
    fullPath = join(parentDir, subdirName);
    state.subagentDirectories.set(subagentKey, fullPath);
  }

  // Register this as the active directory for this execution context
  state.activeDirectoryByContext.set(contextKey, fullPath);

  return fullPath;
}

/**
 * Environment variable name for zero-code activation.
 */
export const ENV_LOG_RAW_DIRECTORY = "LLMIST_LOG_RAW_DIRECTORY";

/**
 * Options for configuring file-based LLM logging.
 */
export interface FileLoggingOptions {
  /**
   * Directory where log files will be written.
   * Will be created recursively if it doesn't exist.
   */
  directory: string;

  /**
   * Starting counter for file numbering. Default: 1
   */
  startingCounter?: number;

  /**
   * Number of digits for zero-padded file numbers. Default: 4
   * Example: 4 produces "0001", "0042", etc.
   */
  counterPadding?: number;

  /**
   * Skip logging for subagent calls. Default: true
   * When true, only main agent calls are logged.
   */
  skipSubagents?: boolean;

  /**
   * Custom formatter for request content.
   * By default, uses formatLlmRequest() which produces human-readable output.
   */
  formatRequest?: (messages: LLMMessage[]) => string;

  /**
   * Callback invoked after each file is written.
   * Useful for tracking, metrics, or UI updates.
   */
  onFileWritten?: (info: FileWrittenInfo) => void;
}

/**
 * Information about a written log file.
 */
export interface FileWrittenInfo {
  /** Full path to the written file */
  filePath: string;

  /** Type of log file */
  type: "request" | "response";

  /** LLM call number (1-indexed) within the current directory */
  callNumber: number;

  /** Length of the written content in characters */
  contentLength: number;

  /** Gadget invocation ID that spawned this subagent (undefined for main agent) */
  parentGadgetInvocationId?: string;

  /** Subagent depth (undefined for main agent) */
  depth?: number;
}

/**
 * Formats LLM messages as plain text for debugging.
 *
 * Each message is formatted with a header showing the role (USER, ASSISTANT, SYSTEM)
 * followed by the message content. Multimodal content is converted to text.
 *
 * @param messages - Array of LLM messages to format
 * @returns Formatted string with all messages
 *
 * @example
 * ```typescript
 * const formatted = formatLlmRequest([
 *   { role: "system", content: "You are a helpful assistant." },
 *   { role: "user", content: "Hello!" }
 * ]);
 * // Output:
 * // === SYSTEM ===
 * // You are a helpful assistant.
 * //
 * // === USER ===
 * // Hello!
 * ```
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
 * Formats a call number as a zero-padded string.
 *
 * @param n - The number to format
 * @param padding - Number of digits (default: 4)
 * @returns Zero-padded string (e.g., 1 → "0001", 42 → "0042")
 *
 * @example
 * ```typescript
 * formatCallNumber(1);    // "0001"
 * formatCallNumber(42);   // "0042"
 * formatCallNumber(1, 6); // "000001"
 * ```
 */
export function formatCallNumber(n: number, padding = 4): string {
  return n.toString().padStart(padding, "0");
}

/**
 * Writes a log file, creating the directory if needed.
 *
 * @param dir - Directory path
 * @param filename - File name
 * @param content - Content to write
 */
async function writeLogFile(dir: string, filename: string, content: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), content, "utf-8");
}

/**
 * Creates hooks for file-based LLM request/response logging.
 *
 * Files are named `{counter}.request` and `{counter}.response` where counter
 * is a zero-padded number that increments with each LLM call.
 *
 * @param options - Configuration options
 * @param state - Optional state container for session isolation. If not provided,
 *                uses a default global state. Pass `createFileLoggingState()` for
 *                isolated testing or independent agent sessions.
 * @returns AgentHooks configuration for use with .withHooks()
 *
 * @example
 * ```typescript
 * // Standard usage (shared global state):
 * const hooks = createFileLoggingHooks({
 *   directory: './debug-logs',
 *   onFileWritten: (info) => console.log(`Wrote ${info.filePath}`)
 * });
 *
 * // Isolated state for testing:
 * const state = createFileLoggingState();
 * const hooks = createFileLoggingHooks({ directory: './logs' }, state);
 *
 * const agent = LLMist.createAgent()
 *   .withHooks(hooks)
 *   .ask("Hello");
 * ```
 */
export function createFileLoggingHooks(
  options: FileLoggingOptions,
  state: FileLoggingState = getDefaultState(),
): AgentHooks {
  const {
    startingCounter = 1,
    counterPadding = 4,
    skipSubagents = true,
    formatRequest = formatLlmRequest,
    onFileWritten,
  } = options;

  // Normalize directory path to prevent /tmp/logs vs /tmp/logs/ issues
  const baseDirectory = resolve(options.directory);

  // Initialize base directory counter if needed (subtract 1 because getNextCounter increments first)
  if (!state.counters.has(baseDirectory)) {
    state.counters.set(baseDirectory, startingCounter - 1);
  }

  // Track current call for request-response correlation within this hook instance
  let currentCallNumber = 0;
  let currentDirectory = baseDirectory;

  return {
    observers: {
      /**
       * Write request file when LLM call is ready (messages are finalized).
       */
      onLLMCallReady: async (context) => {
        // Skip subagent calls if configured
        if (skipSubagents && context.subagentContext) {
          return;
        }

        // Resolve directory (may create numbered subdirectory for subagents)
        currentDirectory = resolveLoggingDirectory(
          state,
          baseDirectory,
          counterPadding,
          context.subagentContext,
        );

        // Get next counter for THIS directory (local to the agent/subagent)
        currentCallNumber = getNextCounter(state, currentDirectory);

        const filename = `${formatCallNumber(currentCallNumber, counterPadding)}.request`;
        const content = formatRequest(context.options.messages);

        try {
          await writeLogFile(currentDirectory, filename, content);

          if (onFileWritten) {
            onFileWritten({
              filePath: join(currentDirectory, filename),
              type: "request",
              callNumber: currentCallNumber,
              contentLength: content.length,
              parentGadgetInvocationId: context.subagentContext?.parentGadgetInvocationId,
              depth: context.subagentContext?.depth,
            });
          }
        } catch (error) {
          // Graceful degradation: log warning but don't crash agent
          console.warn(`[file-logging] Failed to write ${filename}:`, error);
        }
      },

      /**
       * Write response file when LLM call completes.
       */
      onLLMCallComplete: async (context) => {
        // Skip subagent calls if configured
        if (skipSubagents && context.subagentContext) {
          return;
        }

        // Guard: ensure onLLMCallReady was called first and set currentCallNumber
        if (currentCallNumber === 0) {
          console.warn("[file-logging] Skipping response write: no matching request recorded");
          return;
        }

        const filename = `${formatCallNumber(currentCallNumber, counterPadding)}.response`;
        const content = context.rawResponse;

        try {
          await writeLogFile(currentDirectory, filename, content);

          if (onFileWritten) {
            onFileWritten({
              filePath: join(currentDirectory, filename),
              type: "response",
              callNumber: currentCallNumber,
              contentLength: content.length,
              parentGadgetInvocationId: context.subagentContext?.parentGadgetInvocationId,
              depth: context.subagentContext?.depth,
            });
          }
        } catch (error) {
          // Graceful degradation: log warning but don't crash agent
          console.warn(`[file-logging] Failed to write ${filename}:`, error);
        }
      },
    },
  };
}

/**
 * Gets file logging hooks from environment variable configuration.
 *
 * Checks for the `LLMIST_LOG_RAW_DIRECTORY` environment variable.
 * If set, returns configured hooks; otherwise returns undefined.
 *
 * @returns AgentHooks if env var is set, undefined otherwise
 *
 * @example
 * ```typescript
 * // In your application startup or AgentBuilder:
 * const envHooks = getEnvFileLoggingHooks();
 * if (envHooks) {
 *   builder.withHooks(envHooks);
 * }
 * ```
 */
export function getEnvFileLoggingHooks(): AgentHooks | undefined {
  const directory = process.env[ENV_LOG_RAW_DIRECTORY]?.trim();
  if (!directory) {
    return undefined;
  }

  return createFileLoggingHooks({ directory });
}
