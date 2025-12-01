/**
 * LLM Assistance Hints System
 *
 * Provides reusable hook factories that inject helpful context and coaching
 * messages to guide LLM behavior during agentic execution.
 *
 * ## Two Types of Hints
 *
 * 1. **Proactive (beforeLLMCall)**: Inject context before LLM generates response
 *    - Example: Iteration progress ("You're on iteration 3/10")
 *
 * 2. **Reactive (afterLLMCall)**: Coach based on what LLM did
 *    - Example: "Tip: You can call multiple gadgets in parallel"
 *
 * ## Usage
 *
 * ```typescript
 * import { createHints, iterationProgressHint, parallelGadgetHint } from "llmist";
 *
 * // Option 1: Use individual hints
 * const agent = new AgentBuilder()
 *   .withHooks(HookPresets.merge(
 *     iterationProgressHint({ timing: "late" }),
 *     parallelGadgetHint(),
 *   ))
 *   .build();
 *
 * // Option 2: Use convenience factory
 * const agent = new AgentBuilder()
 *   .withHooks(createHints({
 *     iterationProgress: { timing: "late" },
 *     parallelGadgets: true,
 *   }))
 *   .build();
 * ```
 *
 * @module agent/hints
 */

import {
  DEFAULT_HINTS,
  resolveHintTemplate,
  type HintContext,
  type HintTemplate,
} from "../core/prompt-config.js";
import { HookPresets } from "./hook-presets.js";
import type { AgentHooks } from "./hooks.js";

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

/**
 * Options for iteration progress hint.
 */
export interface IterationHintOptions {
  /**
   * When to show the hint.
   * - "always": Show on every iteration
   * - "late": Show only when >= 50% through iterations
   * - "urgent": Show only when >= 80% through iterations
   * @default "always"
   */
  timing?: "always" | "late" | "urgent";

  /**
   * Whether to include urgency indicators for late iterations.
   * Adds extra text when running low on iterations.
   * @default true
   */
  showUrgency?: boolean;

  /**
   * Custom template. Supports placeholders: {iteration}, {maxIterations}, {remaining}
   * Or a function receiving HintContext.
   * @default DEFAULT_HINTS.iterationProgressHint
   */
  template?: HintTemplate;
}

/**
 * Options for parallel gadget usage hint.
 */
export interface ParallelGadgetHintOptions {
  /**
   * Minimum number of gadget calls to consider "efficient".
   * If response has fewer calls, hint will suggest parallelization.
   * @default 2
   */
  minGadgetsForEfficiency?: number;

  /**
   * Custom message when single gadget detected.
   * @default DEFAULT_HINTS.parallelGadgetsHint
   */
  message?: string;

  /**
   * Whether to enable this hint.
   * @default true
   */
  enabled?: boolean;
}

/**
 * Combined hints configuration for createHints().
 */
export interface HintsConfig {
  /**
   * Enable iteration progress hints.
   * Pass `true` for defaults, or options object for customization.
   */
  iterationProgress?: boolean | IterationHintOptions;

  /**
   * Enable parallel gadget hints.
   * Pass `true` for defaults, or options object for customization.
   */
  parallelGadgets?: boolean | ParallelGadgetHintOptions;

  /**
   * Additional custom hooks to merge.
   */
  custom?: AgentHooks[];
}

// ============================================================================
// HINT FACTORIES
// ============================================================================

/**
 * Creates a proactive hint that informs the LLM about iteration progress.
 *
 * This hint is injected before each LLM call (via beforeLLMCall controller),
 * helping the LLM understand how much "budget" remains for completing the task.
 *
 * @param options - Configuration options
 * @returns AgentHooks that can be merged with other hooks
 *
 * @example
 * ```typescript
 * // Basic usage - show on every iteration
 * const hooks = iterationProgressHint();
 *
 * // Show only when running low on iterations
 * const hooks = iterationProgressHint({ timing: "late" });
 *
 * // Custom template
 * const hooks = iterationProgressHint({
 *   template: "Turn {iteration} of {maxIterations}. {remaining} turns left.",
 * });
 * ```
 */
export function iterationProgressHint(options?: IterationHintOptions): AgentHooks {
  const { timing = "always", showUrgency = true, template } = options ?? {};

  return {
    controllers: {
      beforeLLMCall: async (ctx) => {
        const iteration = ctx.iteration + 1; // 1-based for user-friendliness
        const maxIterations = ctx.maxIterations;
        const progress = iteration / maxIterations;

        // Check timing condition
        if (timing === "late" && progress < 0.5) {
          return { action: "proceed" };
        }
        if (timing === "urgent" && progress < 0.8) {
          return { action: "proceed" };
        }

        // Build hint context with all fields populated
        const remaining = maxIterations - iteration;
        const hintContext: HintContext = {
          iteration,
          maxIterations,
          remaining,
        };

        // Resolve template
        let hint = resolveHintTemplate(
          template,
          DEFAULT_HINTS.iterationProgressHint,
          hintContext,
        );

        // Add urgency indicator if late in iterations
        if (showUrgency && progress >= 0.8) {
          hint += " ⚠️ Running low on iterations - focus on completing the task.";
        }

        // Inject as system-level context in messages
        const messages = [...ctx.options.messages];

        // Find last user message index (compatible with older ES targets)
        let lastUserIndex = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === "user") {
            lastUserIndex = i;
            break;
          }
        }

        if (lastUserIndex >= 0) {
          // Insert hint after the last user message
          messages.splice(lastUserIndex + 1, 0, {
            role: "user",
            content: `[System Hint] ${hint}`,
          });
        } else {
          // No user messages found - append hint at the end
          messages.push({
            role: "user",
            content: `[System Hint] ${hint}`,
          });
        }

        return {
          action: "proceed",
          modifiedOptions: { messages },
        };
      },
    },
  };
}

/**
 * Creates a reactive hint that encourages parallel gadget usage.
 *
 * This hint analyzes the LLM's response and, if only a single gadget was called,
 * appends a reminder that multiple gadgets can be used in parallel for efficiency.
 *
 * @param options - Configuration options
 * @returns AgentHooks that can be merged with other hooks
 *
 * @example
 * ```typescript
 * // Basic usage
 * const hooks = parallelGadgetHint();
 *
 * // Custom threshold and message
 * const hooks = parallelGadgetHint({
 *   minGadgetsForEfficiency: 3,
 *   message: "Consider calling multiple gadgets at once!",
 * });
 * ```
 */
export function parallelGadgetHint(options?: ParallelGadgetHintOptions): AgentHooks {
  const {
    minGadgetsForEfficiency = 2,
    message = DEFAULT_HINTS.parallelGadgetsHint,
    enabled = true,
  } = options ?? {};

  return {
    controllers: {
      afterLLMCall: async (ctx) => {
        if (!enabled) {
          return { action: "continue" };
        }

        // Only hint if gadgets were called but below efficiency threshold
        if (ctx.gadgetCallCount > 0 && ctx.gadgetCallCount < minGadgetsForEfficiency) {
          return {
            action: "append_messages",
            messages: [
              {
                role: "user",
                content: `[System Hint] ${message}`,
              },
            ],
          };
        }

        return { action: "continue" };
      },
    },
  };
}

// ============================================================================
// CONVENIENCE FACTORY
// ============================================================================

/**
 * Creates combined hints from a configuration object.
 *
 * This is a convenience function that creates and merges multiple hints
 * based on a simple configuration object.
 *
 * @param config - Configuration for which hints to enable
 * @returns Merged AgentHooks
 *
 * @example
 * ```typescript
 * const hooks = createHints({
 *   iterationProgress: { timing: "late" },
 *   parallelGadgets: true,
 * });
 *
 * const agent = new AgentBuilder()
 *   .withHooks(HookPresets.merge(existingHooks, hooks))
 *   .build();
 * ```
 */
export function createHints(config: HintsConfig): AgentHooks {
  const hooksToMerge: AgentHooks[] = [];

  // Iteration progress hint
  if (config.iterationProgress) {
    const options =
      typeof config.iterationProgress === "boolean" ? {} : config.iterationProgress;
    hooksToMerge.push(iterationProgressHint(options));
  }

  // Parallel gadgets hint
  if (config.parallelGadgets) {
    const options =
      typeof config.parallelGadgets === "boolean" ? {} : config.parallelGadgets;
    hooksToMerge.push(parallelGadgetHint(options));
  }

  // Custom hooks
  if (config.custom) {
    hooksToMerge.push(...config.custom);
  }

  return HookPresets.merge(...hooksToMerge);
}
