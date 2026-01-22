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
import { join } from "node:path";

import { extractMessageText, type LLMMessage } from "../core/messages.js";
import type { AgentHooks } from "./hooks.js";

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

  /** LLM call number (1-indexed) */
  callNumber: number;

  /** Length of the written content in characters */
  contentLength: number;
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
 * @returns AgentHooks configuration for use with .withHooks()
 *
 * @example
 * ```typescript
 * const hooks = createFileLoggingHooks({
 *   directory: './debug-logs',
 *   onFileWritten: (info) => console.log(`Wrote ${info.filePath}`)
 * });
 *
 * const agent = LLMist.createAgent()
 *   .withHooks(hooks)
 *   .ask("Hello");
 * ```
 */
export function createFileLoggingHooks(options: FileLoggingOptions): AgentHooks {
  const {
    directory,
    startingCounter = 1,
    counterPadding = 4,
    skipSubagents = true,
    formatRequest = formatLlmRequest,
    onFileWritten,
  } = options;

  let callCounter = startingCounter - 1; // Will be incremented before first use

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

        callCounter++;
        const filename = `${formatCallNumber(callCounter, counterPadding)}.request`;
        const content = formatRequest(context.options.messages);

        try {
          await writeLogFile(directory, filename, content);

          if (onFileWritten) {
            onFileWritten({
              filePath: join(directory, filename),
              type: "request",
              callNumber: callCounter,
              contentLength: content.length,
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

        const filename = `${formatCallNumber(callCounter, counterPadding)}.response`;
        const content = context.rawResponse;

        try {
          await writeLogFile(directory, filename, content);

          if (onFileWritten) {
            onFileWritten({
              filePath: join(directory, filename),
              type: "response",
              callNumber: callCounter,
              contentLength: content.length,
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
