/**
 * LLMist client wrapper that automatically reports LLM costs via callback.
 *
 * Used internally by ExecutionContext to provide ctx.llmist for gadgets.
 * All LLM calls made through this wrapper will have their costs automatically
 * tracked and reported via the provided callback.
 *
 * @module gadgets/cost-reporting-client
 */

import type { LLMist } from "../core/client.js";
import type {
  ImageGenerationOptions,
  ImageGenerationResult,
  SpeechGenerationOptions,
  SpeechGenerationResult,
} from "../core/media-types.js";
import type { ModelRegistry } from "../core/model-registry.js";
import type { LLMGenerationOptions, LLMStream, LLMStreamChunk } from "../core/options.js";
import type { QuickOptions } from "../core/quick-methods.js";
import { resolveModel } from "../core/model-shortcuts.js";
import type {
  CostReportingImageNamespace,
  CostReportingLLMist,
  CostReportingSpeechNamespace,
} from "./types.js";

/**
 * Callback type for reporting costs.
 */
export type CostReporter = (amount: number) => void;

/**
 * LLMist client wrapper that automatically reports LLM costs.
 *
 * This wrapper intercepts all LLM calls, tracks token usage from responses,
 * calculates costs using ModelRegistry, and reports them via the callback.
 *
 * @example
 * ```typescript
 * let totalCost = 0;
 * const wrapper = new CostReportingLLMistWrapper(client, (cost) => {
 *   totalCost += cost;
 * });
 *
 * // LLM cost automatically reported after completion
 * const result = await wrapper.complete("Hello");
 * console.log(`Cost: $${totalCost}`);
 * ```
 */
export class CostReportingLLMistWrapper implements CostReportingLLMist {
  readonly image: CostReportingImageNamespace;
  readonly speech: CostReportingSpeechNamespace;

  constructor(
    private readonly client: LLMist,
    private readonly reportCost: CostReporter,
  ) {
    // Initialize image namespace with cost reporting
    this.image = {
      generate: async (options: ImageGenerationOptions): Promise<ImageGenerationResult> => {
        const result = await this.client.image.generate(options);
        // Report cost if available in the result
        if (result.cost !== undefined && result.cost > 0) {
          this.reportCost(result.cost);
        }
        return result;
      },
    };

    // Initialize speech namespace with cost reporting
    this.speech = {
      generate: async (options: SpeechGenerationOptions): Promise<SpeechGenerationResult> => {
        const result = await this.client.speech.generate(options);
        // Report cost if available in the result
        if (result.cost !== undefined && result.cost > 0) {
          this.reportCost(result.cost);
        }
        return result;
      },
    };
  }

  /**
   * Access to model registry for cost estimation.
   */
  get modelRegistry(): ModelRegistry {
    return this.client.modelRegistry;
  }

  /**
   * Quick completion with automatic cost reporting.
   *
   * Streams internally to track token usage, then reports the calculated cost.
   *
   * @param prompt - User prompt
   * @param options - Optional configuration (model, temperature, etc.)
   * @returns Complete text response
   */
  async complete(prompt: string, options?: QuickOptions): Promise<string> {
    const model = resolveModel(options?.model ?? "haiku");
    let result = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    let cacheCreationInputTokens = 0;

    const messages = [
      ...(options?.systemPrompt ? [{ role: "system" as const, content: options.systemPrompt }] : []),
      { role: "user" as const, content: prompt },
    ];

    for await (const chunk of this.client.stream({
      model,
      messages,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
    })) {
      result += chunk.text ?? "";
      if (chunk.usage) {
        inputTokens = chunk.usage.inputTokens;
        outputTokens = chunk.usage.outputTokens;
        cachedInputTokens = chunk.usage.cachedInputTokens ?? 0;
        cacheCreationInputTokens = chunk.usage.cacheCreationInputTokens ?? 0;
      }
    }

    this.reportCostFromUsage(model, inputTokens, outputTokens, cachedInputTokens, cacheCreationInputTokens);
    return result;
  }

  /**
   * Quick streaming with automatic cost reporting when stream completes.
   *
   * Yields text chunks as they arrive, then reports cost in finally block.
   *
   * @param prompt - User prompt
   * @param options - Optional configuration (model, temperature, etc.)
   * @returns Async generator yielding text chunks
   */
  async *streamText(prompt: string, options?: QuickOptions): AsyncGenerator<string> {
    const model = resolveModel(options?.model ?? "haiku");
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    let cacheCreationInputTokens = 0;

    const messages = [
      ...(options?.systemPrompt ? [{ role: "system" as const, content: options.systemPrompt }] : []),
      { role: "user" as const, content: prompt },
    ];

    try {
      for await (const chunk of this.client.stream({
        model,
        messages,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
      })) {
        if (chunk.text) {
          yield chunk.text;
        }
        if (chunk.usage) {
          inputTokens = chunk.usage.inputTokens;
          outputTokens = chunk.usage.outputTokens;
          cachedInputTokens = chunk.usage.cachedInputTokens ?? 0;
          cacheCreationInputTokens = chunk.usage.cacheCreationInputTokens ?? 0;
        }
      }
    } finally {
      // Report cost when stream ends (success or early exit)
      this.reportCostFromUsage(model, inputTokens, outputTokens, cachedInputTokens, cacheCreationInputTokens);
    }
  }

  /**
   * Low-level stream access with automatic cost reporting.
   *
   * Returns a wrapped stream that reports costs when iteration completes.
   *
   * @param options - Full LLM generation options
   * @returns Wrapped LLM stream that auto-reports costs
   */
  stream(options: LLMGenerationOptions): LLMStream {
    return this.createCostReportingStream(options);
  }

  /**
   * Creates a wrapped stream that tracks usage and reports costs on completion.
   */
  private createCostReportingStream(options: LLMGenerationOptions): LLMStream {
    const innerStream = this.client.stream(options);
    const reportCostFromUsage = this.reportCostFromUsage.bind(this);
    const model = options.model;

    async function* costReportingWrapper(): AsyncGenerator<LLMStreamChunk> {
      let inputTokens = 0;
      let outputTokens = 0;
      let cachedInputTokens = 0;
      let cacheCreationInputTokens = 0;

      try {
        for await (const chunk of innerStream) {
          if (chunk.usage) {
            inputTokens = chunk.usage.inputTokens;
            outputTokens = chunk.usage.outputTokens;
            cachedInputTokens = chunk.usage.cachedInputTokens ?? 0;
            cacheCreationInputTokens = chunk.usage.cacheCreationInputTokens ?? 0;
          }
          yield chunk;
        }
      } finally {
        // Report cost when stream completes (success or early exit)
        if (inputTokens > 0 || outputTokens > 0) {
          reportCostFromUsage(model, inputTokens, outputTokens, cachedInputTokens, cacheCreationInputTokens);
        }
      }
    }

    return costReportingWrapper();
  }

  /**
   * Calculates and reports cost from token usage.
   */
  private reportCostFromUsage(
    model: string,
    inputTokens: number,
    outputTokens: number,
    cachedInputTokens = 0,
    cacheCreationInputTokens = 0,
  ): void {
    if (inputTokens === 0 && outputTokens === 0) return;

    // Extract model name from provider:model format
    const modelName = model.includes(":") ? model.split(":")[1] : model;

    const estimate = this.client.modelRegistry.estimateCost(
      modelName,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheCreationInputTokens,
    );

    if (estimate && estimate.totalCost > 0) {
      this.reportCost(estimate.totalCost);
    }
  }
}
