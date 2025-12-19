import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { LLMist } from "llmist";
import type { LLMGenerationOptions, LLMStreamChunk, ModelDescriptor } from "llmist";
import type { ProviderAdapter } from "llmist";

class StubAdapter implements ProviderAdapter {
  public readonly providerId = "openai" as const;
  public readonly received: Array<{ options: LLMGenerationOptions; descriptor: ModelDescriptor }> =
    [];
  constructor(private readonly chunks: LLMStreamChunk[]) {}

  supports(descriptor: ModelDescriptor): boolean {
    return descriptor.provider === this.providerId;
  }

  stream(options: LLMGenerationOptions, descriptor: ModelDescriptor) {
    this.received.push({ options, descriptor });
    return (async function* (chunks: LLMStreamChunk[]) {
      for (const chunk of chunks) {
        yield chunk;
      }
    })(this.chunks);
  }
}

describe("LLMist", () => {
  const ORIGINAL_ENV = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  };

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_ENV.OPENAI_API_KEY !== undefined) {
      process.env.OPENAI_API_KEY = ORIGINAL_ENV.OPENAI_API_KEY;
    } else {
      delete process.env.OPENAI_API_KEY;
    }

    if (ORIGINAL_ENV.ANTHROPIC_API_KEY !== undefined) {
      process.env.ANTHROPIC_API_KEY = ORIGINAL_ENV.ANTHROPIC_API_KEY;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }

    if (ORIGINAL_ENV.GEMINI_API_KEY !== undefined) {
      process.env.GEMINI_API_KEY = ORIGINAL_ENV.GEMINI_API_KEY;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
  });

  it("delegates streaming to the matching provider", async () => {
    const chunks: LLMStreamChunk[] = [{ text: "Hello" }, { text: " world", finishReason: "stop" }];
    const adapter = new StubAdapter(chunks);
    const client = new LLMist([adapter]);

    const options: LLMGenerationOptions = {
      model: "openai:gpt-test",
      messages: [
        { role: "system", content: "You are a test." },
        { role: "user", content: "Say hello" },
      ],
    };

    const result: LLMStreamChunk[] = [];
    for await (const chunk of client.stream(options)) {
      result.push(chunk);
    }

    expect(result).toEqual(chunks);
    expect(adapter.received).toHaveLength(1);
    expect(adapter.received[0]?.descriptor).toEqual({ provider: "openai", name: "gpt-test" });
  });

  it("auto-discovers providers from environment keys by default", () => {
    process.env.OPENAI_API_KEY = "test-key";
    const client = new LLMist();

    expect(client.modelRegistry.listModels("openai")).not.toHaveLength(0);
  });

  it("throws a helpful error when no providers are available", () => {
    expect(() => new LLMist()).toThrowError(/No LLM providers available/i);
  });
});
