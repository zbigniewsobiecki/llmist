/**
 * Vision Analysis Namespace
 *
 * Provides one-shot image analysis without agent setup.
 * Useful for quick image understanding tasks.
 *
 * @example
 * ```typescript
 * const llmist = new LLMist();
 *
 * const description = await llmist.vision.analyze({
 *   model: "gpt-4o",
 *   image: await readFile("photo.jpg"),
 *   prompt: "Describe this image in detail",
 * });
 *
 * console.log(description);
 * ```
 */

import type { LLMist } from "../client.js";
import type { ImageMimeType } from "../input-content.js";
import {
  detectImageMimeType,
  imageFromBuffer,
  imageFromUrl,
  isDataUrl,
  parseDataUrl,
  text,
} from "../input-content.js";
import { LLMMessageBuilder } from "../messages.js";

/**
 * Options for vision analysis.
 */
export interface VisionAnalyzeOptions {
  /** Model to use (must support vision, e.g., "gpt-4o", "claude-sonnet-4-20250514", "gemini-2.5-flash") */
  model: string;

  /** Image data: Buffer, Uint8Array, base64 string, data URL, or HTTPS URL */
  image: string | Buffer | Uint8Array;

  /** Analysis prompt describing what to do with the image */
  prompt: string;

  /** MIME type (auto-detected if not provided for Buffer/Uint8Array) */
  mimeType?: ImageMimeType;

  /** System prompt for analysis context */
  systemPrompt?: string;

  /** Max tokens for response */
  maxTokens?: number;

  /** Temperature (0-1) */
  temperature?: number;
}

/**
 * Result of vision analysis.
 */
export interface VisionAnalyzeResult {
  /** The analysis text */
  text: string;

  /** Model used */
  model: string;

  /** Token usage if available */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export class VisionNamespace {
  constructor(private readonly client: LLMist) {}

  /**
   * Build a message builder with the image content attached.
   * Handles URLs, data URLs, base64 strings, and binary buffers.
   */
  private buildImageMessage(options: VisionAnalyzeOptions): LLMMessageBuilder {
    const builder = new LLMMessageBuilder();

    if (options.systemPrompt) {
      builder.addSystem(options.systemPrompt);
    }

    // Handle different image source types
    if (typeof options.image === "string") {
      if (options.image.startsWith("http://") || options.image.startsWith("https://")) {
        // URL - only supported by OpenAI
        builder.addUserWithImageUrl(options.prompt, options.image);
      } else if (isDataUrl(options.image)) {
        // Data URL - parse and use
        const parsed = parseDataUrl(options.image);
        if (!parsed) {
          throw new Error("Invalid data URL format");
        }
        builder.addUserWithImage(options.prompt, parsed.data, parsed.mimeType as ImageMimeType);
      } else {
        // Assume base64 string
        const buffer = Buffer.from(options.image, "base64");
        builder.addUserWithImage(options.prompt, buffer, options.mimeType);
      }
    } else {
      // Buffer or Uint8Array
      builder.addUserWithImage(options.prompt, options.image, options.mimeType);
    }

    return builder;
  }

  /**
   * Stream the response and collect text and usage information.
   */
  private async streamAndCollect(
    options: VisionAnalyzeOptions,
    builder: LLMMessageBuilder,
  ): Promise<{ text: string; usage?: VisionAnalyzeResult["usage"] }> {
    let response = "";
    let finalUsage: VisionAnalyzeResult["usage"] | undefined;

    for await (const chunk of this.client.stream({
      model: options.model,
      messages: builder.build(),
      maxTokens: options.maxTokens,
      temperature: options.temperature,
    })) {
      response += chunk.text;
      if (chunk.usage) {
        finalUsage = {
          inputTokens: chunk.usage.inputTokens,
          outputTokens: chunk.usage.outputTokens,
          totalTokens: chunk.usage.totalTokens,
        };
      }
    }

    return { text: response.trim(), usage: finalUsage };
  }

  /**
   * Analyze an image with a vision-capable model.
   * Returns the analysis as a string.
   *
   * @param options - Vision analysis options
   * @returns Promise resolving to the analysis text
   * @throws Error if the image format is unsupported or model doesn't support vision
   *
   * @example
   * ```typescript
   * // From file
   * const result = await llmist.vision.analyze({
   *   model: "gpt-4o",
   *   image: await fs.readFile("photo.jpg"),
   *   prompt: "What's in this image?",
   * });
   *
   * // From URL (OpenAI only)
   * const result = await llmist.vision.analyze({
   *   model: "gpt-4o",
   *   image: "https://example.com/image.jpg",
   *   prompt: "Describe this image",
   * });
   * ```
   */
  async analyze(options: VisionAnalyzeOptions): Promise<string> {
    const builder = this.buildImageMessage(options);
    const { text } = await this.streamAndCollect(options, builder);
    return text;
  }

  /**
   * Analyze an image and return detailed result with usage info.
   *
   * @param options - Vision analysis options
   * @returns Promise resolving to the analysis result with usage info
   */
  async analyzeWithUsage(options: VisionAnalyzeOptions): Promise<VisionAnalyzeResult> {
    const builder = this.buildImageMessage(options);
    const { text, usage } = await this.streamAndCollect(options, builder);

    return {
      text,
      model: options.model,
      usage,
    };
  }

  /**
   * Check if a model supports vision/image input.
   *
   * @param modelId - Model ID to check
   * @returns True if the model supports vision
   */
  supportsModel(modelId: string): boolean {
    const spec = this.client.modelRegistry.getModelSpec(modelId);
    return spec?.features?.vision === true;
  }

  /**
   * List all models that support vision.
   *
   * @returns Array of model IDs that support vision
   */
  listModels(): string[] {
    return this.client.modelRegistry
      .listModels()
      .filter((spec) => spec.features?.vision === true)
      .map((spec) => spec.modelId);
  }
}
