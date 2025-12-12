import {
  type AudioMimeType,
  detectAudioMimeType,
  detectImageMimeType,
  type ImageMimeType,
  isAudioPart,
  isImagePart,
  toBase64,
} from "../core/input-content.js";
import type { LLMMessage, MessageContent } from "../core/messages.js";
import { extractText } from "../core/messages.js";
import { getMockManager } from "./mock-manager.js";
import type {
  MockMatcher,
  MockMatcherContext,
  MockRegistration,
  MockResponse,
} from "./mock-types.js";

// ============================================================================
// Multimodal Content Helpers
// ============================================================================

/**
 * Check if message content contains at least one image.
 */
function hasImageContent(content: MessageContent): boolean {
  if (typeof content === "string") return false;
  return content.some((part) => isImagePart(part));
}

/**
 * Check if message content contains audio.
 */
function hasAudioContent(content: MessageContent): boolean {
  if (typeof content === "string") return false;
  return content.some((part) => isAudioPart(part));
}

/**
 * Count the number of images in message content.
 */
function countImages(content: MessageContent): number {
  if (typeof content === "string") return 0;
  return content.filter((part) => isImagePart(part)).length;
}

/**
 * Fluent builder for creating mock responses and registrations.
 * Provides a convenient API for common mocking scenarios.
 *
 * @example
 * ```typescript
 * import { mockLLM } from 'llmist';
 *
 * // Simple text mock
 * mockLLM()
 *   .forModel('gpt-5')
 *   .returns('Hello, world!')
 *   .register();
 *
 * // Mock with gadget calls
 * mockLLM()
 *   .forProvider('anthropic')
 *   .whenMessageContains('calculate')
 *   .returnsGadgetCalls([
 *     { gadgetName: 'calculator', parameters: { operation: 'add', a: 1, b: 2 } }
 *   ])
 *   .register();
 *
 * // Complex conditional mock
 * mockLLM()
 *   .when((ctx) => ctx.messages.length > 5)
 *   .returns('This conversation is getting long!')
 *   .once()
 *   .register();
 * ```
 */
export class MockBuilder {
  private matchers: MockMatcher[] = [];
  private response:
    | MockResponse
    | ((context: MockMatcherContext) => MockResponse | Promise<MockResponse>) = {};
  private label?: string;
  private isOnce = false;
  private id?: string;

  /**
   * Match calls to a specific model (by name, supports partial matching).
   *
   * @example
   * mockLLM().forModel('gpt-5')
   * mockLLM().forModel('claude') // matches any Claude model
   */
  forModel(modelName: string): this {
    if (!modelName || modelName.trim() === "") {
      throw new Error("Model name cannot be empty");
    }
    this.matchers.push((ctx) => ctx.modelName.includes(modelName));
    return this;
  }

  /**
   * Match calls to any model.
   * Useful when you want to mock responses regardless of the model used.
   *
   * @example
   * mockLLM().forAnyModel()
   */
  forAnyModel(): this {
    this.matchers.push(() => true);
    return this;
  }

  /**
   * Match calls to a specific provider.
   *
   * @example
   * mockLLM().forProvider('openai')
   * mockLLM().forProvider('anthropic')
   */
  forProvider(provider: string): this {
    if (!provider || provider.trim() === "") {
      throw new Error("Provider name cannot be empty");
    }
    this.matchers.push((ctx) => ctx.provider === provider);
    return this;
  }

  /**
   * Match calls to any provider.
   * Useful when you want to mock responses regardless of the provider used.
   *
   * @example
   * mockLLM().forAnyProvider()
   */
  forAnyProvider(): this {
    this.matchers.push(() => true);
    return this;
  }

  /**
   * Match when any message contains the given text (case-insensitive).
   *
   * @example
   * mockLLM().whenMessageContains('hello')
   */
  whenMessageContains(text: string): this {
    this.matchers.push((ctx) =>
      ctx.messages.some((msg) =>
        extractText(msg.content).toLowerCase().includes(text.toLowerCase()),
      ),
    );
    return this;
  }

  /**
   * Match when the last message contains the given text (case-insensitive).
   *
   * @example
   * mockLLM().whenLastMessageContains('goodbye')
   */
  whenLastMessageContains(text: string): this {
    this.matchers.push((ctx) => {
      const lastMsg = ctx.messages[ctx.messages.length - 1];
      if (!lastMsg) return false;
      return extractText(lastMsg.content).toLowerCase().includes(text.toLowerCase());
    });
    return this;
  }

  /**
   * Match when any message matches the given regex.
   *
   * @example
   * mockLLM().whenMessageMatches(/calculate \d+/)
   */
  whenMessageMatches(regex: RegExp): this {
    this.matchers.push((ctx) => ctx.messages.some((msg) => regex.test(extractText(msg.content))));
    return this;
  }

  /**
   * Match when a message with a specific role contains text.
   *
   * @example
   * mockLLM().whenRoleContains('system', 'You are a helpful assistant')
   */
  whenRoleContains(role: LLMMessage["role"], text: string): this {
    this.matchers.push((ctx) =>
      ctx.messages.some(
        (msg) =>
          msg.role === role && extractText(msg.content).toLowerCase().includes(text.toLowerCase()),
      ),
    );
    return this;
  }

  /**
   * Match based on the number of messages in the conversation.
   *
   * @example
   * mockLLM().whenMessageCount((count) => count > 10)
   */
  whenMessageCount(predicate: (count: number) => boolean): this {
    this.matchers.push((ctx) => predicate(ctx.messages.length));
    return this;
  }

  /**
   * Add a custom matcher function.
   * This provides full control over matching logic.
   *
   * @example
   * mockLLM().when((ctx) => {
   *   return ctx.options.temperature > 0.8;
   * })
   */
  when(matcher: MockMatcher): this {
    this.matchers.push(matcher);
    return this;
  }

  // ==========================================================================
  // Multimodal Matchers
  // ==========================================================================

  /**
   * Match when any message contains an image.
   *
   * @example
   * mockLLM().whenMessageHasImage().returns("I see an image of a sunset.")
   */
  whenMessageHasImage(): this {
    this.matchers.push((ctx) => ctx.messages.some((msg) => hasImageContent(msg.content)));
    return this;
  }

  /**
   * Match when any message contains audio.
   *
   * @example
   * mockLLM().whenMessageHasAudio().returns("I hear music playing.")
   */
  whenMessageHasAudio(): this {
    this.matchers.push((ctx) => ctx.messages.some((msg) => hasAudioContent(msg.content)));
    return this;
  }

  /**
   * Match based on the number of images in the last message.
   *
   * @example
   * mockLLM().whenImageCount((n) => n >= 2).returns("Comparing multiple images...")
   */
  whenImageCount(predicate: (count: number) => boolean): this {
    this.matchers.push((ctx) => {
      const lastMsg = ctx.messages[ctx.messages.length - 1];
      if (!lastMsg) return false;
      return predicate(countImages(lastMsg.content));
    });
    return this;
  }

  /**
   * Set the text response to return.
   * Can be a static string or a function that returns a string dynamically.
   *
   * @example
   * mockLLM().returns('Hello, world!')
   * mockLLM().returns(() => `Response at ${Date.now()}`)
   * mockLLM().returns((ctx) => `You said: ${ctx.messages[0]?.content}`)
   */
  returns(text: string | ((context: MockMatcherContext) => string | Promise<string>)): this {
    if (typeof text === "function") {
      // Convert function to full response generator
      // Use Promise.resolve().then() to properly handle both sync and async errors
      this.response = async (ctx) => {
        const resolvedText = await Promise.resolve().then(() => text(ctx));
        return { text: resolvedText };
      };
    } else {
      if (typeof this.response === "function") {
        throw new Error("Cannot use returns() after withResponse() with a function");
      }
      this.response.text = text;
    }
    return this;
  }

  /**
   * Set gadget calls to include in the response.
   *
   * @example
   * mockLLM().returnsGadgetCalls([
   *   { gadgetName: 'calculator', parameters: { op: 'add', a: 1, b: 2 } }
   * ])
   */
  returnsGadgetCalls(
    calls: Array<{
      gadgetName: string;
      parameters: Record<string, unknown>;
      invocationId?: string;
    }>,
  ): this {
    if (typeof this.response === "function") {
      throw new Error("Cannot use returnsGadgetCalls() after withResponse() with a function");
    }
    this.response.gadgetCalls = calls;
    return this;
  }

  /**
   * Add a single gadget call to the response.
   *
   * @example
   * mockLLM()
   *   .returnsGadgetCall('calculator', { op: 'add', a: 1, b: 2 })
   *   .returnsGadgetCall('logger', { message: 'Done!' })
   */
  returnsGadgetCall(gadgetName: string, parameters: Record<string, unknown>): this {
    if (typeof this.response === "function") {
      throw new Error("Cannot use returnsGadgetCall() after withResponse() with a function");
    }
    if (!this.response.gadgetCalls) {
      this.response.gadgetCalls = [];
    }
    this.response.gadgetCalls.push({ gadgetName, parameters });
    return this;
  }

  // ==========================================================================
  // Multimodal Response Helpers
  // ==========================================================================

  /**
   * Return a single image in the response.
   * Useful for mocking image generation endpoints.
   *
   * @param data - Image data (base64 string or Buffer)
   * @param mimeType - MIME type (auto-detected if Buffer provided without type)
   *
   * @example
   * mockLLM()
   *   .forModel('dall-e-3')
   *   .returnsImage(pngBuffer)
   *   .register();
   */
  returnsImage(data: string | Buffer | Uint8Array, mimeType?: ImageMimeType): this {
    if (typeof this.response === "function") {
      throw new Error("Cannot use returnsImage() after withResponse() with a function");
    }

    let imageData: string;
    let imageMime: ImageMimeType;

    if (typeof data === "string") {
      imageData = data;
      if (!mimeType) {
        throw new Error("MIME type is required when providing base64 string data");
      }
      imageMime = mimeType;
    } else {
      imageData = toBase64(data);
      const detected = mimeType ?? detectImageMimeType(data);
      if (!detected) {
        throw new Error(
          "Could not detect image MIME type. Please provide the mimeType parameter explicitly.",
        );
      }
      imageMime = detected;
    }

    if (!this.response.images) {
      this.response.images = [];
    }
    this.response.images.push({ data: imageData, mimeType: imageMime });
    return this;
  }

  /**
   * Return multiple images in the response.
   *
   * @example
   * mockLLM()
   *   .forModel('dall-e-3')
   *   .returnsImages([
   *     { data: pngBuffer1 },
   *     { data: pngBuffer2 },
   *   ])
   *   .register();
   */
  returnsImages(
    images: Array<{
      data: string | Buffer | Uint8Array;
      mimeType?: ImageMimeType;
      revisedPrompt?: string;
    }>,
  ): this {
    for (const img of images) {
      this.returnsImage(img.data, img.mimeType);
      // Set revised prompt if provided (on the last added image)
      if (img.revisedPrompt && this.response && typeof this.response !== "function") {
        const lastImage = this.response.images?.[this.response.images.length - 1];
        if (lastImage) {
          lastImage.revisedPrompt = img.revisedPrompt;
        }
      }
    }
    return this;
  }

  /**
   * Return audio data in the response.
   * Useful for mocking speech synthesis endpoints.
   *
   * @param data - Audio data (base64 string or Buffer)
   * @param mimeType - MIME type (auto-detected if Buffer provided without type)
   *
   * @example
   * mockLLM()
   *   .forModel('tts-1')
   *   .returnsAudio(mp3Buffer)
   *   .register();
   */
  returnsAudio(data: string | Buffer | Uint8Array, mimeType?: AudioMimeType): this {
    if (typeof this.response === "function") {
      throw new Error("Cannot use returnsAudio() after withResponse() with a function");
    }

    let audioData: string;
    let audioMime: AudioMimeType;

    if (typeof data === "string") {
      audioData = data;
      if (!mimeType) {
        throw new Error("MIME type is required when providing base64 string data");
      }
      audioMime = mimeType;
    } else {
      audioData = toBase64(data);
      const detected = mimeType ?? detectAudioMimeType(data);
      if (!detected) {
        throw new Error(
          "Could not detect audio MIME type. Please provide the mimeType parameter explicitly.",
        );
      }
      audioMime = detected;
    }

    this.response.audio = { data: audioData, mimeType: audioMime };
    return this;
  }

  /**
   * Set the complete mock response object.
   * This allows full control over all response properties.
   * Can also be a function that generates the response dynamically based on context.
   *
   * @example
   * // Static response
   * mockLLM().withResponse({
   *   text: 'Hello',
   *   usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
   *   finishReason: 'stop'
   * })
   *
   * @example
   * // Dynamic response
   * mockLLM().withResponse((ctx) => ({
   *   text: `You said: ${ctx.messages[ctx.messages.length - 1]?.content}`,
   *   usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
   * }))
   */
  withResponse(
    response:
      | MockResponse
      | ((context: MockMatcherContext) => MockResponse | Promise<MockResponse>),
  ): this {
    this.response = response;
    return this;
  }

  /**
   * Set simulated token usage.
   *
   * @example
   * mockLLM().withUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 })
   */
  withUsage(usage: { inputTokens: number; outputTokens: number; totalTokens: number }): this {
    if (typeof this.response === "function") {
      throw new Error("Cannot use withUsage() after withResponse() with a function");
    }
    if (usage.inputTokens < 0 || usage.outputTokens < 0 || usage.totalTokens < 0) {
      throw new Error("Token counts cannot be negative");
    }
    if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
      throw new Error("totalTokens must equal inputTokens + outputTokens");
    }
    this.response.usage = usage;
    return this;
  }

  /**
   * Set the finish reason.
   *
   * @example
   * mockLLM().withFinishReason('stop')
   * mockLLM().withFinishReason('length')
   */
  withFinishReason(reason: string): this {
    if (typeof this.response === "function") {
      throw new Error("Cannot use withFinishReason() after withResponse() with a function");
    }
    this.response.finishReason = reason;
    return this;
  }

  /**
   * Set initial delay before streaming starts (simulates network latency).
   *
   * @example
   * mockLLM().withDelay(100) // 100ms delay
   */
  withDelay(ms: number): this {
    if (typeof this.response === "function") {
      throw new Error("Cannot use withDelay() after withResponse() with a function");
    }
    if (ms < 0) {
      throw new Error("Delay must be non-negative");
    }
    this.response.delayMs = ms;
    return this;
  }

  /**
   * Set delay between stream chunks (simulates realistic streaming).
   *
   * @example
   * mockLLM().withStreamDelay(10) // 10ms between chunks
   */
  withStreamDelay(ms: number): this {
    if (typeof this.response === "function") {
      throw new Error("Cannot use withStreamDelay() after withResponse() with a function");
    }
    if (ms < 0) {
      throw new Error("Stream delay must be non-negative");
    }
    this.response.streamDelayMs = ms;
    return this;
  }

  /**
   * Set a label for this mock (useful for debugging).
   *
   * @example
   * mockLLM().withLabel('greeting mock')
   */
  withLabel(label: string): this {
    this.label = label;
    return this;
  }

  /**
   * Set a specific ID for this mock.
   *
   * @example
   * mockLLM().withId('my-custom-mock-id')
   */
  withId(id: string): this {
    this.id = id;
    return this;
  }

  /**
   * Mark this mock as one-time use (will be removed after first match).
   *
   * @example
   * mockLLM().once()
   */
  once(): this {
    this.isOnce = true;
    return this;
  }

  /**
   * Build the mock registration without registering it.
   * Useful if you want to register it manually later.
   *
   * @returns The built MockRegistration object (without id if not specified)
   */
  build(): Omit<MockRegistration, "id"> & { id?: string } {
    // Guard against empty matchers
    if (this.matchers.length === 0) {
      throw new Error(
        "Mock must have at least one matcher. Use .when(), .forModel(), .forProvider(), etc.",
      );
    }

    // Combine all matchers with AND logic
    const combinedMatcher: MockMatcher = async (ctx) => {
      for (const matcher of this.matchers) {
        const matches = await Promise.resolve(matcher(ctx));
        if (!matches) return false;
      }
      return true;
    };

    return {
      id: this.id,
      matcher: combinedMatcher,
      response: this.response,
      label: this.label,
      once: this.isOnce,
    };
  }

  /**
   * Register this mock with the global MockManager.
   * Returns the ID of the registered mock.
   *
   * @example
   * const mockId = mockLLM().forModel('gpt-5').returns('Hello!').register();
   * // Later: getMockManager().unregister(mockId);
   */
  register(): string {
    const mockManager = getMockManager();
    const registration = this.build();
    return mockManager.register(registration);
  }
}

/**
 * Create a new MockBuilder instance.
 * This is the main entry point for the fluent mock API.
 *
 * @example
 * ```typescript
 * import { mockLLM } from 'llmist';
 *
 * mockLLM()
 *   .forModel('gpt-5')
 *   .whenMessageContains('hello')
 *   .returns('Hello there!')
 *   .register();
 * ```
 */
export function mockLLM(): MockBuilder {
  return new MockBuilder();
}
