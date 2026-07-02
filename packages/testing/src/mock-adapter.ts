import type {
  ImageGenerationOptions,
  ImageGenerationResult,
  LLMGenerationOptions,
  LLMStream,
  ModelDescriptor,
  ProviderAdapter,
  ResearchEvent,
  ResearchJobRef,
  ResearchOptions,
  ResearchStatus,
  ResearchStatusSnapshot,
  ResearchUsage,
  SpeechGenerationOptions,
  SpeechGenerationResult,
} from "llmist";
import { getMockManager, type MockManager } from "./mock-manager.js";
import { createMockStream } from "./mock-stream.js";
import type {
  MockMatcherContext,
  MockOptions,
  MockResearchData,
  MockResearchJobEntry,
  MockResponse,
} from "./mock-types.js";

/**
 * Provider adapter that serves mock responses instead of making real LLM API calls.
 * This is useful for testing applications that use llmist without incurring API costs.
 *
 * The MockProviderAdapter has high priority (100) and is always checked before
 * real providers when both are registered. This enables selective mocking where
 * some models use mocks while others use real providers. If no matching mock is
 * found and strictMode is disabled, requests return an empty response.
 *
 * @example
 * ```typescript
 * import { LLMist, createMockAdapter, mockLLM } from 'llmist/testing';
 *
 * // Use with real providers for selective mocking
 * const client = new LLMist({
 *   adapters: [createMockAdapter()],
 *   autoDiscoverProviders: true // Also loads real OpenAI, Anthropic, etc.
 * });
 *
 * // Register mocks for specific models
 * mockLLM()
 *   .forModel('gpt-5-nano')
 *   .returns('Test response')
 *   .register();
 *
 * // gpt-5-nano uses mock, other models use real providers
 * const stream = client.stream({
 *   model: 'openai:gpt-5-nano',
 *   messages: [{ role: 'user', content: 'test' }]
 * });
 * ```
 */
export class MockProviderAdapter implements ProviderAdapter {
  readonly providerId = "mock";
  readonly priority = 100; // High priority: check mocks before real providers
  private readonly mockManager: MockManager;

  constructor(options?: MockOptions) {
    this.mockManager = getMockManager(options);
  }

  supports(_descriptor: ModelDescriptor): boolean {
    // Support any provider when using mock adapter
    // This allows tests to use "openai:gpt-4", "anthropic:claude", etc.
    return true;
  }

  stream(options: LLMGenerationOptions, descriptor: ModelDescriptor, _spec?: unknown): LLMStream {
    // Create matcher context
    const context: MockMatcherContext = {
      model: options.model,
      provider: descriptor.provider,
      modelName: descriptor.name,
      options,
      messages: options.messages,
    };

    // Find matching mock (async operation)
    // We need to handle this in the stream generator
    return this.createMockStreamFromContext(context);
  }

  private async *createMockStreamFromContext(context: MockMatcherContext): LLMStream {
    // Find matching mock
    const mockResponse = await this.mockManager.findMatch(context);

    if (!mockResponse) {
      // This should not happen if MockManager is configured correctly
      // but handle it gracefully
      yield {
        text: "",
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
      return;
    }

    // Stream the mock response
    yield* createMockStream(mockResponse);
  }

  // ==========================================================================
  // Image Generation Support
  // ==========================================================================

  /**
   * Check if this adapter supports image generation for a given model.
   * Returns true if there's a registered mock with images for this model.
   */
  supportsImageGeneration(_modelId: string): boolean {
    // Always return true so the mock adapter can intercept all image requests
    return true;
  }

  /**
   * Generate mock images based on registered mocks.
   *
   * @param options - Image generation options
   * @returns Mock image generation result
   */
  async generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
    // Create a matcher context for image generation
    const context: MockMatcherContext = {
      model: options.model,
      provider: "mock",
      modelName: options.model,
      options: {
        model: options.model,
        messages: [{ role: "user", content: options.prompt }],
      },
      messages: [{ role: "user", content: options.prompt }],
    };

    const mockResponse = await this.mockManager.findMatch(context);

    if (!mockResponse?.images || mockResponse.images.length === 0) {
      throw new Error(
        `No mock registered for image generation with model "${options.model}". ` +
          `Use mockLLM().forModel("${options.model}").returnsImage(...).register() to add one.`,
      );
    }

    return this.createImageResult(options, mockResponse);
  }

  /**
   * Transform mock response into ImageGenerationResult format.
   *
   * @param options - Original image generation options
   * @param mockResponse - Mock response containing image data
   * @returns ImageGenerationResult with mock data and zero cost
   */
  private createImageResult(
    options: ImageGenerationOptions,
    mockResponse: MockResponse,
  ): ImageGenerationResult {
    const images = mockResponse.images ?? [];

    return {
      images: images.map((img) => ({
        b64Json: img.data,
        revisedPrompt: img.revisedPrompt,
      })),
      model: options.model,
      usage: {
        imagesGenerated: images.length,
        size: options.size ?? "1024x1024",
        quality: options.quality ?? "standard",
      },
      cost: 0, // Mock cost is always 0
    };
  }

  // ==========================================================================
  // Speech Generation Support
  // ==========================================================================

  /**
   * Check if this adapter supports speech generation for a given model.
   * Returns true if there's a registered mock with audio for this model.
   */
  supportsSpeechGeneration(_modelId: string): boolean {
    // Always return true so the mock adapter can intercept all speech requests
    return true;
  }

  /**
   * Generate mock speech based on registered mocks.
   *
   * @param options - Speech generation options
   * @returns Mock speech generation result
   */
  async generateSpeech(options: SpeechGenerationOptions): Promise<SpeechGenerationResult> {
    // Create a matcher context for speech generation
    const context: MockMatcherContext = {
      model: options.model,
      provider: "mock",
      modelName: options.model,
      options: {
        model: options.model,
        messages: [{ role: "user", content: options.input }],
      },
      messages: [{ role: "user", content: options.input }],
    };

    const mockResponse = await this.mockManager.findMatch(context);

    if (!mockResponse?.audio) {
      throw new Error(
        `No mock registered for speech generation with model "${options.model}". ` +
          `Use mockLLM().forModel("${options.model}").returnsAudio(...).register() to add one.`,
      );
    }

    return this.createSpeechResult(options, mockResponse);
  }

  /**
   * Transform mock response into SpeechGenerationResult format.
   * Converts base64 audio data to ArrayBuffer.
   *
   * @param options - Original speech generation options
   * @param mockResponse - Mock response containing audio data
   * @returns SpeechGenerationResult with mock data and zero cost
   */
  private createSpeechResult(
    options: SpeechGenerationOptions,
    mockResponse: MockResponse,
  ): SpeechGenerationResult {
    // biome-ignore lint/style/noNonNullAssertion: audio is verified to exist in generateSpeech before calling this
    const audio = mockResponse.audio!;

    // Convert base64 to ArrayBuffer
    const binaryString = Buffer.from(audio.data, "base64").toString("binary");
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Determine audio format from MIME type
    const format = this.mimeTypeToAudioFormat(audio.mimeType);

    return {
      audio: bytes.buffer,
      model: options.model,
      usage: {
        characterCount: options.input.length,
      },
      cost: 0, // Mock cost is always 0
      format,
    };
  }

  /**
   * Map MIME type to audio format for SpeechGenerationResult.
   * Defaults to "mp3" for unknown MIME types.
   *
   * @param mimeType - Audio MIME type string
   * @returns Audio format identifier
   */
  private mimeTypeToAudioFormat(mimeType: string): "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm" {
    const mapping: Record<string, "mp3" | "opus" | "aac" | "flac" | "wav" | "pcm"> = {
      "audio/mp3": "mp3",
      "audio/mpeg": "mp3",
      "audio/wav": "wav",
      "audio/webm": "opus",
      "audio/ogg": "opus",
    };
    return mapping[mimeType] ?? "mp3";
  }

  // ==========================================================================
  // Deep Research Support
  // ==========================================================================

  /**
   * Simulated server-side research job store. Lives on the shared MockManager
   * singleton so background-job refs survive across adapter/client instances
   * ("process restarts" in tests); cleared by getMockManager().clear().
   */
  private get researchJobs(): Map<string, MockResearchJobEntry> {
    return this.mockManager.researchJobs;
  }

  /**
   * Check if this adapter supports research for a given model.
   * Always true so the mock adapter can intercept all research requests.
   */
  supportsResearch(_modelId: string): boolean {
    return true;
  }

  /**
   * Start a mock research run based on registered mocks.
   * Register one via `mockLLM()...returnsResearch(...)` or `mockResearch(...)`.
   */
  startResearch(
    options: ResearchOptions,
    descriptor: ModelDescriptor,
  ): AsyncIterable<ResearchEvent> {
    const context: MockMatcherContext = {
      model: options.model,
      provider: descriptor.provider,
      modelName: descriptor.name,
      options: {
        model: options.model,
        messages: [{ role: "user", content: options.query }],
      },
      messages: [{ role: "user", content: options.query }],
    };
    return this.createResearchStream(context, options);
  }

  /** Replay a mock research run's events strictly after the ref's cursor. */
  resumeResearch(ref: ResearchJobRef, signal?: AbortSignal): AsyncIterable<ResearchEvent> {
    const job = this.researchJobs.get(ref.jobId);
    if (!job) {
      throw new Error(`No mock research job "${ref.jobId}" to resume.`);
    }
    const cursorNum = ref.cursor === undefined ? -1 : Number(ref.cursor);
    const remaining = job.events.filter(
      (event) => event.cursor !== undefined && Number(event.cursor) > cursorNum,
    );
    // Resumed streams are healthy — failAtEvent is not re-applied.
    return emitResearchEvents(remaining, undefined, signal);
  }

  /** Status of a mock research job (terminal status once the script ends). */
  async getResearchStatus(ref: ResearchJobRef): Promise<ResearchStatusSnapshot> {
    const job = this.researchJobs.get(ref.jobId);
    if (!job) {
      throw new Error(`No mock research job "${ref.jobId}".`);
    }
    return { status: job.terminalStatus };
  }

  /** Cancel is a no-op for mock research jobs (recorded as cancelled). */
  async cancelResearch(ref: ResearchJobRef): Promise<void> {
    const job = this.researchJobs.get(ref.jobId);
    if (job) {
      job.terminalStatus = "cancelled";
    }
  }

  private async *createResearchStream(
    context: MockMatcherContext,
    options: ResearchOptions,
  ): AsyncGenerator<ResearchEvent> {
    const mockResponse = await this.mockManager.findMatch(context);

    if (!mockResponse?.research) {
      throw new Error(
        `No mock registered for research with model "${options.model}". ` +
          `Use mockLLM().forModel("${options.model}").returnsResearch(...).register() to add one.`,
      );
    }

    const data = mockResponse.research;
    // Id allocation lives on the shared manager — a per-adapter counter
    // could mint duplicate ids across adapter instances (shared store).
    const jobId = data.jobId ?? this.mockManager.allocateResearchJobId();
    const events = buildResearchEvents(data, jobId);

    const createdJobId = findCreatedJobId(events);
    if (createdJobId !== null) {
      this.researchJobs.set(createdJobId, {
        events,
        terminalStatus: data.status ?? "completed",
      });
    }

    yield* emitResearchEvents(events, data.failAtEvent, options.signal);
  }
}

/** First `created` event's job id, or null. */
function findCreatedJobId(events: ResearchEvent[]): string | null {
  for (const event of events) {
    if (event.type === "created") {
      return event.jobId;
    }
  }
  return null;
}

async function* emitResearchEvents(
  events: ResearchEvent[],
  failAtEvent: number | undefined,
  signal: AbortSignal | undefined,
): AsyncGenerator<ResearchEvent> {
  let emitted = 0;
  for (const event of events) {
    if (signal?.aborted) {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      throw abortError;
    }
    if (failAtEvent !== undefined && emitted >= failAtEvent) {
      throw new Error("Mock research stream failure (failAtEvent)");
    }
    yield event;
    emitted += 1;
  }
}

/**
 * Build the event script for a mock research run: either the user's explicit
 * script (cursors auto-assigned from index when missing) or a synthesized
 * realistic sequence.
 */
function buildResearchEvents(data: MockResearchData, jobId: string): ResearchEvent[] {
  if (data.events) {
    return data.events.map((event, index) => ({
      ...event,
      cursor: event.cursor ?? String(index),
    }));
  }

  const report = data.report ?? "";
  const midpoint = Math.ceil(report.length / 2);
  const usage: ResearchUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    ...data.usage,
  };

  const events: ResearchEvent[] = [
    { type: "created", jobId },
    { type: "status", status: "in_progress" },
    { type: "phase", phase: "searching" },
    { type: "search", action: "search", status: "started", query: "mock search" },
    { type: "search", action: "search", status: "completed", url: "https://mock.example" },
    { type: "phase", phase: "writing" },
    { type: "thinking", delta: "Synthesizing findings..." },
  ];
  if (report.length > 0) {
    events.push({ type: "text", delta: report.slice(0, midpoint) });
    if (midpoint < report.length) {
      events.push({ type: "text", delta: report.slice(midpoint) });
    }
  }
  for (const citation of data.citations ?? []) {
    events.push({ type: "citation", citation });
  }
  events.push(
    { type: "usage", usage },
    { type: "done", result: { status: data.status ?? "completed", report: "" } },
  );

  return events.map((event, index) => ({ ...event, cursor: String(index) }));
}

/**
 * Create a mock provider adapter instance.
 * This is a convenience factory function.
 *
 * @param options - Optional configuration for the mock system
 * @returns A configured MockProviderAdapter
 *
 * @example
 * ```typescript
 * const adapter = createMockAdapter({ strictMode: true, debug: true });
 * const client = new LLMist([adapter]);
 * ```
 */
export function createMockAdapter(options?: MockOptions): MockProviderAdapter {
  return new MockProviderAdapter(options);
}
