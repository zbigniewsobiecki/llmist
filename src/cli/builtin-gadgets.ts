/**
 * Built-in gadgets for CLI agent command.
 * These gadgets provide basic communication capabilities out-of-the-box.
 */
import chalk from "chalk";
import { z } from "zod";

import { createGadget } from "../gadgets/create-gadget.js";
import { BreakLoopException, HumanInputException } from "../gadgets/exceptions.js";

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
    question: z.string().describe("The question to ask the user"),
  }),
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
    message: z.string().describe("The message to display to the user"),
    done: z.boolean().describe("Set to true to end the conversation, false to continue"),
    type: z
      .enum(["info", "success", "warning", "error"])
      .default("info")
      .describe("Message type: info, success, warning, or error"),
  }),
  execute: ({ message, done, type }) => {
    const formatters: Record<string, (msg: string) => string> = {
      info: (msg) => chalk.blue(`ℹ️  ${msg}`),
      success: (msg) => chalk.green(`✅ ${msg}`),
      warning: (msg) => chalk.yellow(`⚠️  ${msg}`),
      error: (msg) => chalk.red(`❌ ${msg}`),
    };
    const formatted = formatters[type](message);

    if (done) {
      throw new BreakLoopException(formatted);
    }
    return formatted;
  },
});

/**
 * All built-in gadgets as an array for easy registration.
 */
export const builtinGadgets = [askUser, tellUser];
