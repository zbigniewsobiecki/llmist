/**
 * Quick execution methods for simple use cases.
 *
 * These methods provide convenient shortcuts for common operations
 * without requiring full agent setup.
 *
 * @example
 * ```typescript
 * // Quick completion
 * const answer = await llmist.complete("What is 2+2?");
 *
 * // Quick streaming
 * for await (const chunk of llmist.stream("Tell me a story")) {
 *   process.stdout.write(chunk);
 * }
 * ```
 */

import type { LLMist } from "./client.js";
import { LLMMessageBuilder } from "./messages.js";
import { resolveModel } from "./model-shortcuts.js";

/**
 * Options for quick execution methods.
 */
export interface QuickOptions {
  /** Model to use (supports aliases like "gpt4", "sonnet", "flash") */
  model?: string;

  /** Temperature (0-1) */
  temperature?: number;

  /** System prompt */
  systemPrompt?: string;

  /** Max tokens to generate */
  maxTokens?: number;
}

/**
 * Quick completion - returns final text response.
 *
 * @param client - LLMist client instance
 * @param prompt - User prompt
 * @param options - Optional configuration
 * @returns Complete text response
 *
 * @example
 * ```typescript
 * const client = new LLMist();
 * const answer = await complete(client, "What is 2+2?");
 * console.log(answer); // "4" or "2+2 equals 4"
 * ```
 */
export async function complete(
  client: LLMist,
  prompt: string,
  options: QuickOptions = {},
): Promise<string> {
  const model = resolveModel(options.model ?? "gpt-5-nano");

  const builder = new LLMMessageBuilder();
  if (options.systemPrompt) {
    builder.addSystem(options.systemPrompt);
  }
  builder.addUser(prompt);

  let fullResponse = "";
  for await (const chunk of client.stream({
    model,
    messages: builder.build(),
    temperature: options.temperature,
    maxTokens: options.maxTokens,
  })) {
    fullResponse += chunk.text;
  }

  return fullResponse.trim();
}

/**
 * Quick streaming - returns async generator of text chunks.
 *
 * @param client - LLMist client instance
 * @param prompt - User prompt
 * @param options - Optional configuration
 * @returns Async generator yielding text chunks
 *
 * @example
 * ```typescript
 * const client = new LLMist();
 *
 * for await (const chunk of stream(client, "Tell me a story")) {
 *   process.stdout.write(chunk);
 * }
 * ```
 */
export async function* stream(
  client: LLMist,
  prompt: string,
  options: QuickOptions = {},
): AsyncGenerator<string> {
  const model = resolveModel(options.model ?? "gpt-5-nano");

  const builder = new LLMMessageBuilder();
  if (options.systemPrompt) {
    builder.addSystem(options.systemPrompt);
  }
  builder.addUser(prompt);

  for await (const chunk of client.stream({
    model,
    messages: builder.build(),
    temperature: options.temperature,
    maxTokens: options.maxTokens,
  })) {
    yield chunk.text;
  }
}
