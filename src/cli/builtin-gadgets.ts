/**
 * Built-in gadgets for CLI agent command.
 * These gadgets provide basic communication capabilities out-of-the-box.
 */
import { z } from "zod";

import { createGadget } from "../gadgets/create-gadget.js";
import {
  BreakLoopException,
  HumanInputException,
} from "../gadgets/exceptions.js";

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
    question: z
      .string()
      .describe("The question to ask the user in plain-text or Markdown"),
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
    throw new HumanInputException(question);
  },
});

/**
 * TellUser gadget - Outputs a message to the user and optionally ends the conversation.
 *
 * Use this for key results, warnings, or structured output that should stand out
 * from regular streamed text. Set done=true when the task is complete.
 */
export const tellUser = createGadget({
  name: "TellUser",
  description:
    "Tell the user something important. Set done=true when your work is complete and you want to end the conversation.",
  schema: z.object({
    message: z
      .string()
      .describe("The message to display to the user in Markdown"),
    done: z
      .boolean()
      .default(false)
      .describe("Set to true to end the conversation, false to continue"),
    type: z
      .enum(["info", "success", "warning", "error"])
      .default("info")
      .describe("Message type: info, success, warning, or error"),
  }),
  examples: [
    {
      comment: "Report successful completion and end the conversation",
      params: {
        message: "I've completed the refactoring. All tests pass.",
        done: true,
        type: "success",
      },
    },
    {
      comment: "Warn the user about something without ending",
      params: {
        message: "Found 3 files with potential issues. Continuing analysis...",
        done: false,
        type: "warning",
      },
    },
  ],
  execute: ({ message, done, type }) => {
    // Format message for display, but return plain text for LLM context
    // This prevents ANSI color codes from polluting the conversation
    const prefixes = {
      info: "ℹ️  ",
      success: "✅ ",
      warning: "⚠️  ",
      error: "❌ ",
    };
    const plainResult = prefixes[type] + message;

    if (done) {
      throw new BreakLoopException(plainResult);
    }
    return plainResult;
  },
});

/**
 * All built-in gadgets as an array for easy registration.
 */
export const builtinGadgets = [askUser, tellUser];
