/**
 * Base Provider Adapter
 *
 * Abstract base class for provider adapters that implements the Template Method pattern.
 * This class defines the skeleton of the streaming algorithm, leaving provider-specific
 * details to be implemented by concrete subclasses.
 *
 * The streaming workflow consists of four main steps:
 * 1. Prepare messages (optional transformation for provider-specific requirements)
 * 2. Build the request payload (provider-specific formatting)
 * 3. Execute the stream request (call the provider's SDK)
 * 4. Wrap the stream (transform provider-specific chunks into universal format)
 */

import type { LLMMessage } from "../core/messages.js";
import type { ModelSpec } from "../core/model-catalog.js";
import type { LLMGenerationOptions, LLMStream, ModelDescriptor } from "../core/options.js";
import type { ProviderAdapter } from "./provider.js";

export abstract class BaseProviderAdapter implements ProviderAdapter {
  abstract readonly providerId: string;

  constructor(protected readonly client: unknown) {}

  abstract supports(descriptor: ModelDescriptor): boolean;

  /**
   * Optionally provide model specifications for this provider.
   * This allows the model registry to discover available models and their capabilities.
   */
  getModelSpecs?(): ModelSpec[];

  /**
   * Template method that defines the skeleton of the streaming algorithm.
   * This orchestrates the four-step process without dictating provider-specific details.
   */
  async *stream(
    options: LLMGenerationOptions,
    descriptor: ModelDescriptor,
    spec?: ModelSpec,
  ): LLMStream {
    // Step 1: Prepare messages (can be overridden for special cases like Gemini)
    const preparedMessages = this.prepareMessages(options.messages);

    // Step 2: Build the provider-specific request payload
    const payload = this.buildRequestPayload(options, descriptor, spec, preparedMessages);

    // Step 3: Execute the stream request using the provider's SDK
    const rawStream = await this.executeStreamRequest(payload);

    // Step 4: Transform the provider-specific stream into universal format
    yield* this.wrapStream(rawStream);
  }

  /**
   * Prepare messages for the request.
   * Default implementation returns messages unchanged.
   * Override this to implement provider-specific message transformations
   * (e.g., Gemini's consecutive message merging, Anthropic's system message extraction).
   *
   * @param messages - The input messages
   * @returns Prepared messages
   */
  protected prepareMessages(messages: LLMMessage[]): LLMMessage[] {
    return messages;
  }

  /**
   * Build the provider-specific request payload.
   * This method must be implemented by each concrete provider.
   *
   * @param options - The generation options
   * @param descriptor - The model descriptor
   * @param spec - Optional model specification with metadata
   * @param messages - The prepared messages
   * @returns Provider-specific payload ready for the API call
   */
  protected abstract buildRequestPayload(
    options: LLMGenerationOptions,
    descriptor: ModelDescriptor,
    spec: ModelSpec | undefined,
    messages: LLMMessage[],
  ): unknown;

  /**
   * Execute the stream request using the provider's SDK.
   * This method must be implemented by each concrete provider.
   *
   * @param payload - The provider-specific payload
   * @returns An async iterable of provider-specific chunks
   */
  protected abstract executeStreamRequest(payload: unknown): Promise<AsyncIterable<unknown>>;

  /**
   * Wrap the provider-specific stream into the universal LLMStream format.
   * This method must be implemented by each concrete provider.
   *
   * @param rawStream - The provider-specific stream
   * @returns Universal LLMStream
   */
  protected abstract wrapStream(rawStream: AsyncIterable<unknown>): LLMStream;
}
