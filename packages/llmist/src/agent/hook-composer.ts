import { getEnvFileLoggingHooks } from "./file-logging.js";
import { HookPresets } from "./hook-presets.js";
import type { AgentHooks, BeforeLLMCallAction, LLMCallControllerContext } from "./hooks.js";

/**
 * Context available to trailing message functions.
 * Provides iteration information for dynamic message generation.
 */
export type TrailingMessageContext = Pick<
  LLMCallControllerContext,
  "iteration" | "maxIterations" | "budget" | "totalCost"
>;

/**
 * Trailing message can be a static string or a function that generates the message.
 * The function receives context about the current iteration.
 */
export type TrailingMessage = string | ((ctx: TrailingMessageContext) => string);

/**
 * Logic for composing and augmenting agent hooks.
 *
 * Encapsulates:
 * 1. Merging user hooks with environment-based logging
 * 2. Injecting trailing message controllers
 * 3. Future hook augmentation (e.g. debugging, metrics)
 */
export class HookComposer {
  /**
   * Compose the final hooks, including trailing message injection if configured.
   *
   * @param userHooks - User-provided hooks
   * @param trailingMessage - Optional trailing message configuration
   * @returns Final composed hooks or undefined
   */
  static compose(
    userHooks?: AgentHooks,
    trailingMessage?: TrailingMessage,
  ): AgentHooks | undefined {
    let hooks = userHooks;

    // Auto-inject environment-based file logging if LLMIST_LOG_RAW_DIRECTORY is set
    const envFileLogging = getEnvFileLoggingHooks();
    if (envFileLogging) {
      // Merge env hooks with user hooks (user hooks take precedence)
      hooks = hooks ? HookPresets.merge(envFileLogging, hooks) : envFileLogging;
    }

    // Handle trailing message injection
    if (!trailingMessage) {
      return hooks;
    }

    const trailingMsg = trailingMessage;
    const existingBeforeLLMCall = hooks?.controllers?.beforeLLMCall;

    const trailingMessageController = async (
      ctx: LLMCallControllerContext,
    ): Promise<BeforeLLMCallAction> => {
      // Run existing beforeLLMCall first if present
      const result: BeforeLLMCallAction = existingBeforeLLMCall
        ? await existingBeforeLLMCall(ctx)
        : { action: "proceed" };

      // If action is "skip", don't inject trailing message
      if (result.action === "skip") {
        return result;
      }

      // Get messages (possibly already modified by existing controller)
      const messages = [...(result.modifiedOptions?.messages || ctx.options.messages)];

      // Generate trailing message content
      const content =
        typeof trailingMsg === "function"
          ? trailingMsg({
              iteration: ctx.iteration,
              maxIterations: ctx.maxIterations,
              budget: ctx.budget,
              totalCost: ctx.totalCost,
            })
          : trailingMsg;

      // Append as ephemeral user message
      messages.push({ role: "user", content });

      return {
        action: "proceed",
        modifiedOptions: { ...result.modifiedOptions, messages },
      };
    };

    return {
      ...hooks,
      controllers: {
        ...hooks?.controllers,
        beforeLLMCall: trailingMessageController,
      },
    };
  }
}
