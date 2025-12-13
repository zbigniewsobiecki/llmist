/**
 * Text Generation Namespace
 *
 * Provides text completion and streaming methods.
 * Replaces the deprecated llmist.complete() and llmist.stream() methods.
 *
 * @example
 * ```typescript
 * const llmist = new LLMist();
 *
 * // Complete
 * const answer = await llmist.text.complete("What is 2+2?");
 *
 * // Stream
 * for await (const chunk of llmist.text.stream("Tell me a story")) {
 *   process.stdout.write(chunk);
 * }
 * ```
 */

import type { LLMist } from "../client.js";
import { complete, type TextGenerationOptions, stream } from "../quick-methods.js";

export class TextNamespace {
  constructor(private readonly client: LLMist) {}

  /**
   * Generate a complete text response.
   *
   * @param prompt - User prompt
   * @param options - Optional configuration
   * @returns Complete text response
   */
  async complete(prompt: string, options?: TextGenerationOptions): Promise<string> {
    return complete(this.client, prompt, options);
  }

  /**
   * Stream text chunks.
   *
   * @param prompt - User prompt
   * @param options - Optional configuration
   * @returns Async generator yielding text chunks
   */
  stream(prompt: string, options?: TextGenerationOptions): AsyncGenerator<string> {
    return stream(this.client, prompt, options);
  }
}
