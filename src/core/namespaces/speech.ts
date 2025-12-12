/**
 * Speech Generation Namespace
 *
 * Provides text-to-speech generation methods.
 *
 * @example
 * ```typescript
 * const llmist = new LLMist();
 *
 * const result = await llmist.speech.generate({
 *   model: "tts-1-hd",
 *   input: "Hello, world!",
 *   voice: "nova",
 * });
 *
 * // Save the audio
 * fs.writeFileSync("output.mp3", Buffer.from(result.audio));
 * console.log("Cost:", result.cost);
 * ```
 */

import type { ProviderAdapter } from "../../providers/provider.js";
import type {
  SpeechGenerationOptions,
  SpeechGenerationResult,
  SpeechModelSpec,
} from "../media-types.js";

export class SpeechNamespace {
  constructor(
    private readonly adapters: ProviderAdapter[],
    private readonly defaultProvider: string,
  ) {}

  /**
   * Generate speech audio from text.
   *
   * @param options - Speech generation options
   * @returns Promise resolving to the generation result with audio and cost
   * @throws Error if the provider doesn't support speech generation
   */
  async generate(options: SpeechGenerationOptions): Promise<SpeechGenerationResult> {
    const modelId = options.model;

    // Find an adapter that supports this speech model
    const adapter = this.findSpeechAdapter(modelId);
    if (!adapter || !adapter.generateSpeech) {
      throw new Error(
        `No provider supports speech generation for model "${modelId}". ` +
          `Available speech models: ${this.listModels()
            .map((m) => m.modelId)
            .join(", ")}`,
      );
    }

    return adapter.generateSpeech(options);
  }

  /**
   * List all available speech generation models.
   */
  listModels(): SpeechModelSpec[] {
    const models: SpeechModelSpec[] = [];
    for (const adapter of this.adapters) {
      if (adapter.getSpeechModelSpecs) {
        models.push(...adapter.getSpeechModelSpecs());
      }
    }
    return models;
  }

  /**
   * Check if a model is supported for speech generation.
   */
  supportsModel(modelId: string): boolean {
    return this.findSpeechAdapter(modelId) !== undefined;
  }

  private findSpeechAdapter(modelId: string): ProviderAdapter | undefined {
    return this.adapters.find((adapter) => adapter.supportsSpeechGeneration?.(modelId) ?? false);
  }
}
