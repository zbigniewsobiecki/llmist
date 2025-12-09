import { AgentBuilder } from "../agent/builder.js";
import { discoverProviderAdapters } from "../providers/discovery.js";
import type { ProviderAdapter } from "../providers/provider.js";
import type { LLMMessage } from "./messages.js";
import type { ModelSpec } from "./model-catalog.js";
import { ModelRegistry } from "./model-registry.js";
import { ImageNamespace } from "./namespaces/image.js";
import { SpeechNamespace } from "./namespaces/speech.js";
import { TextNamespace } from "./namespaces/text.js";
import type { LLMGenerationOptions, LLMStream, ModelDescriptor } from "./options.js";
import { ModelIdentifierParser } from "./options.js";
import {
  complete as completeHelper,
  type QuickOptions,
  stream as streamHelper,
} from "./quick-methods.js";

export interface LLMistOptions {
  /**
   * Provider adapters to register manually.
   */
  adapters?: ProviderAdapter[];
  /**
   * Default provider prefix applied when a model identifier omits it.
   */
  defaultProvider?: string;
  /**
   * Automatically discover built-in providers based on environment configuration.
   * Enabled by default.
   */
  autoDiscoverProviders?: boolean;
  /**
   * Custom model specifications to register at initialization.
   * Use this to define models not in the built-in catalog, such as:
   * - Fine-tuned models with custom pricing
   * - New models not yet supported by llmist
   * - Custom deployments with different configurations
   *
   * @example
   * ```ts
   * new LLMist({
   *   customModels: [{
   *     provider: "openai",
   *     modelId: "ft:gpt-4o-2024-08-06:my-org:custom:abc123",
   *     displayName: "My Fine-tuned GPT-4o",
   *     contextWindow: 128_000,
   *     maxOutputTokens: 16_384,
   *     pricing: { input: 7.5, output: 30.0 },
   *     knowledgeCutoff: "2024-08",
   *     features: { streaming: true, functionCalling: true, vision: true }
   *   }]
   * });
   * ```
   */
  customModels?: ModelSpec[];
}

export class LLMist {
  private readonly parser: ModelIdentifierParser;
  private readonly defaultProvider: string;
  readonly modelRegistry: ModelRegistry;
  private readonly adapters: ProviderAdapter[];

  // Namespaces for different generation types
  readonly text: TextNamespace;
  readonly image: ImageNamespace;
  readonly speech: SpeechNamespace;

  constructor();
  constructor(adapters: ProviderAdapter[]);
  constructor(adapters: ProviderAdapter[], defaultProvider: string);
  constructor(options: LLMistOptions);
  constructor(...args: [] | [ProviderAdapter[]] | [ProviderAdapter[], string] | [LLMistOptions]) {
    let adapters: ProviderAdapter[] = [];
    let defaultProvider: string | undefined;
    let autoDiscoverProviders = true;
    let customModels: ModelSpec[] = [];

    if (args.length === 0) {
      // Use defaults
    } else if (Array.isArray(args[0])) {
      adapters = args[0];
      if (args.length > 1) {
        defaultProvider = args[1];
      }
    } else if (typeof args[0] === "object" && args[0] !== null) {
      const options = args[0];
      adapters = options.adapters ?? [];
      defaultProvider = options.defaultProvider;
      customModels = options.customModels ?? [];
      if (typeof options.autoDiscoverProviders === "boolean") {
        autoDiscoverProviders = options.autoDiscoverProviders;
      }
    }

    const discoveredAdapters = autoDiscoverProviders ? discoverProviderAdapters() : [];
    const combinedAdapters: ProviderAdapter[] = [...adapters];
    for (const adapter of discoveredAdapters) {
      if (!combinedAdapters.some((existing) => existing.providerId === adapter.providerId)) {
        combinedAdapters.push(adapter);
      }
    }

    if (combinedAdapters.length === 0) {
      throw new Error(
        "No LLM providers available. Provide adapters explicitly or set provider API keys in the environment.",
      );
    }

    const resolvedDefaultProvider = defaultProvider ?? combinedAdapters[0]?.providerId ?? "openai";

    // Sort by priority (descending: higher priority first)
    // Use stable sort to preserve order for equal priorities
    this.adapters = [...combinedAdapters].sort((a, b) => {
      const priorityA = a.priority ?? 0;
      const priorityB = b.priority ?? 0;
      return priorityB - priorityA;
    });
    this.defaultProvider = resolvedDefaultProvider;
    this.parser = new ModelIdentifierParser(resolvedDefaultProvider);
    this.modelRegistry = new ModelRegistry();

    // Register all providers with the model registry
    for (const adapter of this.adapters) {
      this.modelRegistry.registerProvider(adapter);
    }

    // Register custom models if provided
    if (customModels.length > 0) {
      this.modelRegistry.registerModels(customModels);
    }

    // Initialize generation namespaces
    this.text = new TextNamespace(this);
    this.image = new ImageNamespace(this.adapters, this.defaultProvider);
    this.speech = new SpeechNamespace(this.adapters, this.defaultProvider);
  }

  stream(options: LLMGenerationOptions): LLMStream {
    const descriptor = this.parser.parse(options.model);
    const spec = this.modelRegistry.getModelSpec(descriptor.name);
    const adapter = this.resolveAdapter(descriptor);
    return adapter.stream(options, descriptor, spec);
  }

  /**
   * Count tokens in messages for a given model.
   *
   * Uses provider-specific token counting methods for accurate estimation:
   * - OpenAI: tiktoken library with model-specific encodings
   * - Anthropic: Native messages.countTokens() API
   * - Gemini: SDK's countTokens() method
   *
   * Falls back to character-based estimation (4 chars/token) if the provider
   * doesn't support native token counting or if counting fails.
   *
   * This is useful for:
   * - Pre-request cost estimation
   * - Context window management
   * - Request batching optimization
   *
   * @param model - Model identifier (e.g., "openai:gpt-4", "anthropic:claude-3-5-sonnet-20241022")
   * @param messages - Array of messages to count tokens for
   * @returns Promise resolving to the estimated input token count
   *
   * @example
   * ```typescript
   * const client = new LLMist();
   * const messages = [
   *   { role: 'system', content: 'You are a helpful assistant.' },
   *   { role: 'user', content: 'Hello!' }
   * ];
   *
   * const tokenCount = await client.countTokens('openai:gpt-4', messages);
   * console.log(`Estimated tokens: ${tokenCount}`);
   * ```
   */
  async countTokens(model: string, messages: LLMMessage[]): Promise<number> {
    const descriptor = this.parser.parse(model);
    const spec = this.modelRegistry.getModelSpec(descriptor.name);
    const adapter = this.resolveAdapter(descriptor);

    // Check if the provider supports token counting
    if (adapter.countTokens) {
      return adapter.countTokens(messages, descriptor, spec);
    }

    // Fallback: rough character-based estimation (4 chars per token)
    const totalChars = messages.reduce((sum, msg) => sum + (msg.content?.length ?? 0), 0);
    return Math.ceil(totalChars / 4);
  }

  private resolveAdapter(descriptor: ModelDescriptor): ProviderAdapter {
    const adapter = this.adapters.find((item) => item.supports(descriptor));
    if (!adapter) {
      throw new Error(`No adapter registered for provider ${descriptor.provider}`);
    }

    return adapter;
  }

  /**
   * Quick completion - returns final text response.
   * Convenient for simple queries without needing agent setup.
   *
   * @param prompt - User prompt
   * @param options - Optional configuration
   * @returns Complete text response
   *
   * @example
   * ```typescript
   * const answer = await LLMist.complete("What is 2+2?");
   * console.log(answer); // "4" or "2+2 equals 4"
   *
   * const answer = await LLMist.complete("Tell me a joke", {
   *   model: "sonnet",
   *   temperature: 0.9
   * });
   * ```
   */
  static async complete(prompt: string, options?: QuickOptions): Promise<string> {
    const client = new LLMist();
    return completeHelper(client, prompt, options);
  }

  /**
   * Quick streaming - returns async generator of text chunks.
   * Convenient for streaming responses without needing agent setup.
   *
   * @param prompt - User prompt
   * @param options - Optional configuration
   * @returns Async generator yielding text chunks
   *
   * @example
   * ```typescript
   * for await (const chunk of LLMist.stream("Tell me a story")) {
   *   process.stdout.write(chunk);
   * }
   *
   * // With options
   * for await (const chunk of LLMist.stream("Generate code", {
   *   model: "gpt4",
   *   systemPrompt: "You are a coding assistant"
   * })) {
   *   process.stdout.write(chunk);
   * }
   * ```
   */
  static stream(prompt: string, options?: QuickOptions): AsyncGenerator<string> {
    const client = new LLMist();
    return streamHelper(client, prompt, options);
  }

  /**
   * Instance method: Quick completion using this client instance.
   *
   * @param prompt - User prompt
   * @param options - Optional configuration
   * @returns Complete text response
   */
  async complete(prompt: string, options?: QuickOptions): Promise<string> {
    return completeHelper(this, prompt, options);
  }

  /**
   * Instance method: Quick streaming using this client instance.
   *
   * @param prompt - User prompt
   * @param options - Optional configuration
   * @returns Async generator yielding text chunks
   */
  streamText(prompt: string, options?: QuickOptions): AsyncGenerator<string> {
    return streamHelper(this, prompt, options);
  }

  /**
   * Create a fluent agent builder.
   * Provides a chainable API for configuring and creating agents.
   *
   * @returns AgentBuilder instance for chaining
   *
   * @example
   * ```typescript
   * const agent = LLMist.createAgent()
   *   .withModel("sonnet")
   *   .withSystem("You are a helpful assistant")
   *   .withGadgets(Calculator, Weather)
   *   .ask("What's the weather in Paris?");
   *
   * for await (const event of agent.run()) {
   *   // handle events
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Quick one-liner for simple queries
   * const answer = await LLMist.createAgent()
   *   .withModel("gpt4-mini")
   *   .askAndCollect("What is 2+2?");
   * ```
   */
  static createAgent(): AgentBuilder {
    return new AgentBuilder();
  }

  /**
   * Create agent builder with this client instance.
   * Useful when you want to reuse a configured client.
   *
   * @returns AgentBuilder instance using this client
   *
   * @example
   * ```typescript
   * const client = new LLMist({ ... });
   *
   * const agent = client.createAgent()
   *   .withModel("sonnet")
   *   .ask("Hello");
   * ```
   */
  createAgent(): AgentBuilder {
    return new AgentBuilder(this);
  }
}
