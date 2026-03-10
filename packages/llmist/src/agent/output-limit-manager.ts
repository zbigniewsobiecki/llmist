/**
 * OutputLimitManager - Manages gadget output size limiting.
 *
 * Calculates character limits from model context windows, registers
 * GadgetOutputViewer when enabled, and chains the output limiter
 * interceptor with user-provided hooks.
 */

import type { ILogObj, Logger } from "tslog";
import type { LLMist } from "../core/client.js";
import {
  CHARS_PER_TOKEN,
  DEFAULT_GADGET_OUTPUT_LIMIT,
  DEFAULT_GADGET_OUTPUT_LIMIT_PERCENT,
  FALLBACK_CONTEXT_WINDOW,
} from "../core/constants.js";
import { createGadgetOutputViewer } from "../gadgets/output-viewer.js";
import type { GadgetRegistry } from "../gadgets/registry.js";
import { createLogger } from "../logging/logger.js";
import { GadgetOutputStore } from "./gadget-output-store.js";
import type { AgentHooks, GadgetResultInterceptorContext } from "./hooks.js";

/**
 * Configuration for output limiting.
 */
export interface OutputLimitConfig {
  /** Whether output limiting is enabled (default: true) */
  enabled?: boolean;
  /** Max gadget output as % of model context window (default: 15) */
  limitPercent?: number;
}

/**
 * OutputLimitManager orchestrates gadget output size limiting for an agent.
 *
 * It:
 * - Calculates the character limit from the model context window and limitPercent
 * - Registers GadgetOutputViewer when limiting is enabled
 * - Chains the output limiter interceptor with user-provided hooks
 * - Stores oversized gadget outputs for later browsing
 */
export class OutputLimitManager {
  private readonly outputStore: GadgetOutputStore;
  private readonly enabled: boolean;
  private readonly charLimit: number;
  private readonly logger: Logger<ILogObj>;

  constructor(
    client: LLMist,
    model: string,
    config: OutputLimitConfig,
    registry: GadgetRegistry,
    logger?: Logger<ILogObj>,
  ) {
    this.logger = logger ?? createLogger({ name: "llmist:output-limit-manager" });
    this.enabled = config.enabled ?? DEFAULT_GADGET_OUTPUT_LIMIT;
    this.outputStore = new GadgetOutputStore();

    // Calculate character limit from model context window
    const limitPercent = config.limitPercent ?? DEFAULT_GADGET_OUTPUT_LIMIT_PERCENT;
    const limits = client.modelRegistry.getModelLimits(model);
    const contextWindow = limits?.contextWindow ?? FALLBACK_CONTEXT_WINDOW;
    this.charLimit = Math.floor(contextWindow * (limitPercent / 100) * CHARS_PER_TOKEN);

    // Auto-register GadgetOutputViewer when limiting is enabled
    // Pass the same character limit so viewer output is also bounded
    if (this.enabled) {
      registry.register(
        "GadgetOutputViewer",
        createGadgetOutputViewer(this.outputStore, this.charLimit),
      );
    }
  }

  /**
   * Get the hooks with the output limiter interceptor chained with user hooks.
   *
   * The limiter interceptor runs first, then the user-provided interceptor.
   *
   * @param userHooks - Optional user-provided hooks to chain with
   * @returns AgentHooks with the output limiter interceptor chained in
   */
  getHooks(userHooks?: AgentHooks): AgentHooks {
    if (!this.enabled) {
      return userHooks ?? {};
    }

    const limiterInterceptor = (result: string, ctx: GadgetResultInterceptorContext): string => {
      // Skip limiting for GadgetOutputViewer itself to avoid recursion
      if (ctx.gadgetName === "GadgetOutputViewer") {
        return result;
      }

      if (result.length > this.charLimit) {
        const id = this.outputStore.store(ctx.gadgetName, result);
        const lines = result.split("\n").length;
        const bytes = new TextEncoder().encode(result).length;

        this.logger.info("Gadget output exceeded limit, stored for browsing", {
          gadgetName: ctx.gadgetName,
          outputId: id,
          bytes,
          lines,
          charLimit: this.charLimit,
        });

        return (
          `[Gadget "${ctx.gadgetName}" returned too much data: ` +
          `${bytes.toLocaleString()} bytes, ${lines.toLocaleString()} lines. ` +
          `Use GadgetOutputViewer with id "${id}" to read it]`
        );
      }

      return result;
    };

    // Chain with any user-provided interceptor (limiter runs first)
    const userInterceptor = userHooks?.interceptors?.interceptGadgetResult;
    const chainedInterceptor = userInterceptor
      ? (result: string, ctx: GadgetResultInterceptorContext) =>
          userInterceptor(limiterInterceptor(result, ctx), ctx)
      : limiterInterceptor;

    return {
      ...userHooks,
      interceptors: {
        ...userHooks?.interceptors,
        interceptGadgetResult: chainedInterceptor,
      },
    };
  }

  /**
   * Get the output store for accessing stored oversized outputs.
   *
   * @returns The GadgetOutputStore instance
   */
  getOutputStore(): GadgetOutputStore {
    return this.outputStore;
  }

  /**
   * Check if output limiting is enabled.
   *
   * @returns true if output limiting is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}
