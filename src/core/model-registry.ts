/**
 * Model Registry
 *
 * Centralized registry for querying LLM model specifications,
 * validating configurations, and estimating costs.
 *
 * Model data is provided by ProviderAdapter implementations and
 * automatically populated when providers are registered.
 */

import type { ProviderAdapter } from "../providers/provider.js";
import type { CostEstimate, ModelLimits, ModelSpec } from "./model-catalog.js";

export class ModelRegistry {
  private modelSpecs: ModelSpec[] = [];
  private providerMap = new Map<string, ModelSpec[]>();

  /**
   * Register a provider and collect its model specifications
   */
  registerProvider(provider: ProviderAdapter): void {
    const specs = provider.getModelSpecs?.() ?? [];

    if (specs.length > 0) {
      this.modelSpecs.push(...specs);
      this.providerMap.set(provider.providerId, specs);
    }
  }

  /**
   * Register a custom model specification at runtime
   *
   * Use this to add models that aren't in the built-in catalog, such as:
   * - Fine-tuned models with custom pricing
   * - New models not yet supported by llmist
   * - Custom deployments with different configurations
   *
   * @param spec - Complete model specification
   * @throws {Error} If spec is missing required fields
   *
   * @example
   * ```ts
   * client.modelRegistry.registerModel({
   *   provider: "openai",
   *   modelId: "ft:gpt-4o-2024-08-06:my-org:custom:abc123",
   *   displayName: "My Fine-tuned GPT-4o",
   *   contextWindow: 128_000,
   *   maxOutputTokens: 16_384,
   *   pricing: { input: 7.5, output: 30.0 },
   *   knowledgeCutoff: "2024-08",
   *   features: { streaming: true, functionCalling: true, vision: true }
   * });
   * ```
   */
  registerModel(spec: ModelSpec): void {
    // Validate required fields
    if (!spec.modelId || !spec.provider) {
      throw new Error("ModelSpec must have modelId and provider");
    }

    // Check for duplicates
    const existing = this.getModelSpec(spec.modelId);
    if (existing) {
      console.warn(
        `[llmist] Overwriting existing model spec for "${spec.modelId}". ` +
          `Previous: ${existing.displayName}, New: ${spec.displayName}`,
      );
      // Remove old spec from arrays
      const index = this.modelSpecs.findIndex((m) => m.modelId === spec.modelId);
      if (index !== -1) {
        this.modelSpecs.splice(index, 1);
      }
      // Remove from provider map
      const providerSpecs = this.providerMap.get(spec.provider);
      if (providerSpecs) {
        const providerIndex = providerSpecs.findIndex((m) => m.modelId === spec.modelId);
        if (providerIndex !== -1) {
          providerSpecs.splice(providerIndex, 1);
        }
      }
    }

    // Add to registry
    this.modelSpecs.push(spec);

    // Update provider map
    const providerSpecs = this.providerMap.get(spec.provider) ?? [];
    providerSpecs.push(spec);
    this.providerMap.set(spec.provider, providerSpecs);
  }

  /**
   * Register multiple custom model specifications at once
   *
   * @param specs - Array of complete model specifications
   *
   * @example
   * ```ts
   * client.modelRegistry.registerModels([
   *   { provider: "openai", modelId: "gpt-5", ... },
   *   { provider: "openai", modelId: "gpt-5-mini", ... }
   * ]);
   * ```
   */
  registerModels(specs: ModelSpec[]): void {
    for (const spec of specs) {
      this.registerModel(spec);
    }
  }

  /**
   * Get model specification by model ID
   * @param modelId - Full model identifier (e.g., 'gpt-5', 'claude-sonnet-4-5-20250929')
   * @returns ModelSpec if found, undefined otherwise
   */
  getModelSpec(modelId: string): ModelSpec | undefined {
    return this.modelSpecs.find((model) => model.modelId === modelId);
  }

  /**
   * List all models, optionally filtered by provider
   * @param providerId - Optional provider ID to filter by (e.g., 'openai', 'anthropic')
   * @returns Array of ModelSpec objects
   */
  listModels(providerId?: string): ModelSpec[] {
    if (!providerId) {
      return [...this.modelSpecs];
    }

    return this.providerMap.get(providerId) ?? [];
  }

  /**
   * Get context window and output limits for a model
   * @param modelId - Full model identifier
   * @returns ModelLimits if model found, undefined otherwise
   */
  getModelLimits(modelId: string): ModelLimits | undefined {
    const spec = this.getModelSpec(modelId);
    if (!spec) return undefined;

    return {
      contextWindow: spec.contextWindow,
      maxOutputTokens: spec.maxOutputTokens,
    };
  }

  /**
   * Estimate API cost for a given model and token usage
   * @param modelId - Full model identifier
   * @param inputTokens - Number of input tokens (total, including cached and cache creation)
   * @param outputTokens - Number of output tokens
   * @param cachedInputTokens - Number of cached input tokens (subset of inputTokens)
   * @param cacheCreationInputTokens - Number of cache creation tokens (subset of inputTokens, Anthropic only)
   * @returns CostEstimate if model found, undefined otherwise
   */
  estimateCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    cachedInputTokens = 0,
    cacheCreationInputTokens = 0,
  ): CostEstimate | undefined {
    const spec = this.getModelSpec(modelId);
    if (!spec) return undefined;

    // Pricing is per 1M tokens, so convert to actual cost
    // Cached tokens are charged at a lower rate (or same rate if no cached pricing)
    // Cache creation tokens are charged at a higher rate (Anthropic: 1.25x input)
    const cachedRate = spec.pricing.cachedInput ?? spec.pricing.input;
    const cacheWriteRate = spec.pricing.cacheWriteInput ?? spec.pricing.input;
    const uncachedInputTokens = inputTokens - cachedInputTokens - cacheCreationInputTokens;

    const uncachedInputCost = (uncachedInputTokens / 1_000_000) * spec.pricing.input;
    const cachedInputCost = (cachedInputTokens / 1_000_000) * cachedRate;
    const cacheCreationCost = (cacheCreationInputTokens / 1_000_000) * cacheWriteRate;
    const inputCost = uncachedInputCost + cachedInputCost + cacheCreationCost;
    const outputCost = (outputTokens / 1_000_000) * spec.pricing.output;
    const totalCost = inputCost + outputCost;

    return {
      inputCost,
      cachedInputCost,
      cacheCreationCost,
      outputCost,
      totalCost,
      currency: "USD",
    };
  }

  /**
   * Validate that requested token count fits within model limits
   * @param modelId - Full model identifier
   * @param requestedTokens - Total tokens requested (input + output)
   * @returns true if valid, false if model not found or exceeds limits
   */
  validateModelConfig(modelId: string, requestedTokens: number): boolean {
    const limits = this.getModelLimits(modelId);
    if (!limits) return false;

    return requestedTokens <= limits.contextWindow;
  }

  /**
   * Check if a model supports a specific feature
   * @param modelId - Full model identifier
   * @param feature - Feature to check ('streaming', 'functionCalling', 'vision', etc.)
   * @returns true if model supports feature, false otherwise
   */
  supportsFeature(modelId: string, feature: keyof ModelSpec["features"]): boolean {
    const spec = this.getModelSpec(modelId);
    if (!spec) return false;

    return spec.features[feature] === true;
  }

  /**
   * Get all models that support a specific feature
   * @param feature - Feature to filter by
   * @param providerId - Optional provider ID to filter by
   * @returns Array of ModelSpec objects that support the feature
   */
  getModelsByFeature(feature: keyof ModelSpec["features"], providerId?: string): ModelSpec[] {
    const models = this.listModels(providerId);
    return models.filter((model) => model.features[feature] === true);
  }

  /**
   * Get the most cost-effective model for a given provider and token budget
   * @param inputTokens - Expected input tokens
   * @param outputTokens - Expected output tokens
   * @param providerId - Optional provider ID to filter by
   * @returns ModelSpec with lowest total cost, or undefined if no models found
   */
  getCheapestModel(
    inputTokens: number,
    outputTokens: number,
    providerId?: string,
  ): ModelSpec | undefined {
    const models = this.listModels(providerId);
    if (models.length === 0) return undefined;

    let cheapest: { model: ModelSpec; cost: number } | undefined;

    for (const model of models) {
      const estimate = this.estimateCost(model.modelId, inputTokens, outputTokens);
      if (!estimate) continue;

      if (!cheapest || estimate.totalCost < cheapest.cost) {
        cheapest = { model, cost: estimate.totalCost };
      }
    }

    return cheapest?.model;
  }
}
