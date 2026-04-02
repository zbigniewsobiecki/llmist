/**
 * Built-in gadgets for CLI agent command.
 * These gadgets provide basic communication capabilities out-of-the-box.
 */

import { createGadget, HumanInputRequiredException, TaskCompletionSignal } from "llmist";
import { z } from "zod";
import { createTextToSpeech, type TextToSpeechConfig } from "./builtins/text-to-speech.js";

/**
 * AskUser gadget - Asks the user a question and waits for their response.
 *
 * Use this when you need more information or clarification from the user.
 */
export const askUser = createGadget({
  name: "AskUser",
  description:
    "Ask the user a question when you need more information or clarification. The user's response will be provided back to you.",
  schema: z.object({
    question: z.string().describe("The question to ask the user in plain-text or Markdown"),
  }),
  examples: [
    {
      comment: "Ask for clarification about the task",
      params: { question: "Which file would you like me to modify?" },
    },
    {
      comment: "Ask user to choose between options",
      params: {
        question:
          "I found multiple matches. Which one should I use?\n- src/utils/helper.ts\n- src/lib/helper.ts",
      },
    },
  ],
  execute: ({ question }) => {
    throw new HumanInputRequiredException(question);
  },
});

/**
 * TellUser gadget - Outputs a message to the user.
 *
 * Use this for key results, warnings, or structured output that should stand out
 * from regular streamed text.
 */
export const tellUser = createGadget({
  name: "TellUser",
  description: "Tell the user something important.",
  schema: z.object({
    message: z.string().optional().describe("The message to display to the user in Markdown"),
    type: z
      .enum(["info", "success", "warning", "error"])
      .default("info")
      .describe("Message type: info, success, warning, or error"),
  }),
  examples: [
    {
      comment: "Warn the user about something",
      params: {
        message: "Found 3 files with potential issues. Continuing analysis...",
        type: "warning",
      },
    },
    {
      comment: "Share detailed analysis with bullet points (use heredoc for multiline)",
      params: {
        message:
          "Here's what I found in the codebase:\n\n1. **Main entry point**: `src/index.ts` exports all public APIs\n2. **Core logic**: Located in `src/core/` with 5 modules\n3. **Tests**: Good coverage in `src/__tests__/`\n\nI'll continue exploring the core modules.",
        type: "info",
      },
    },
  ],
  execute: ({ message, type }) => {
    // Handle empty or missing message gracefully
    // This happens when LLM sends malformed parameters that fail to parse the message field
    if (!message || message.trim() === "") {
      return "⚠️  TellUser was called without a message. Please provide content in the 'message' field.";
    }

    // Format message for display, but return plain text for LLM context
    // This prevents ANSI color codes from polluting the conversation
    const prefixes = {
      info: "ℹ️  ",
      success: "✅ ",
      warning: "⚠️  ",
      error: "❌ ",
    };
    return prefixes[type] + message;
  },
});

/**
 * Finish gadget - Signals that the task is complete.
 *
 * Use this when you have completed all requested work and want to end the conversation.
 */
export const finish = createGadget({
  name: "Finish",
  description: "Signal that you have completed your task. Call this when your work is done.",
  schema: z.object({
    message: z.string().optional().describe("A summary of what was accomplished"),
  }),
  examples: [
    {
      comment: "Signal task completion with a summary",
      params: { message: "All requested changes have been applied and tests pass." },
    },
    {
      comment: "Signal task completion without a message",
      params: {},
    },
  ],
  execute: ({ message }) => {
    throw new TaskCompletionSignal(message || "Task completed");
  },
});

/**
 * Factory function to create built-in gadgets with config-driven defaults.
 *
 * This allows gadgets like TextToSpeech to inherit settings from ~/.llmist/cli.toml.
 *
 * @param speechConfig - Optional speech configuration for TextToSpeech gadget
 * @returns Array of built-in gadgets configured with the provided defaults
 *
 * @example
 * ```typescript
 * const fullConfig = loadConfig();
 * const builtins = getBuiltinGadgets(fullConfig.speech);
 * for (const gadget of builtins) {
 *   registry.registerByClass(gadget);
 * }
 * ```
 */
export function getBuiltinGadgets(speechConfig?: TextToSpeechConfig) {
  return [askUser, tellUser, finish, createTextToSpeech(speechConfig)];
}

export type { TextToSpeechConfig };
