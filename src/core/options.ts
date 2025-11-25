import type { LLMMessage } from "./messages.js";

export interface LLMGenerationOptions {
  model: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  responseFormat?: "text";
  metadata?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LLMStreamChunk {
  text: string;
  /**
   * Indicates that the provider has finished producing output and includes the reason if available.
   */
  finishReason?: string | null;
  /**
   * Token usage information, typically available in the final chunk when the stream completes.
   */
  usage?: TokenUsage;
  /**
   * Provider specific payload emitted at the same time as the text chunk. This is useful for debugging and tests.
   */
  rawEvent?: unknown;
}

export interface LLMStream extends AsyncIterable<LLMStreamChunk> {}

export type ProviderIdentifier = string;

export interface ModelDescriptor {
  provider: string;
  name: string;
}

export class ModelIdentifierParser {
  constructor(private readonly defaultProvider: string = "openai") {}

  parse(identifier: string): ModelDescriptor {
    const trimmed = identifier.trim();
    if (!trimmed) {
      throw new Error("Model identifier cannot be empty");
    }

    const [maybeProvider, ...rest] = trimmed.split(":");
    if (rest.length === 0) {
      return { provider: this.defaultProvider, name: maybeProvider };
    }

    const provider = maybeProvider;
    const name = rest.join(":");
    if (!name) {
      throw new Error("Model name cannot be empty");
    }

    return { provider, name };
  }
}
