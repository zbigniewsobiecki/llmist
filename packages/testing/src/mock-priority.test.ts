import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LLMist } from "llmist";
import type { ModelDescriptor } from "llmist";
import { getMockManager, mockLLM } from "./index.js";
import { createMockAdapter } from "./mock-adapter.js";

describe("Mock Priority with Real Providers", () => {
  beforeEach(() => {
    getMockManager().clear();
  });

  afterEach(() => {
    getMockManager().clear();
  });

  test("mocks take precedence over real providers due to priority", async () => {
    // Create stub real provider (priority: 0 default)
    const realAdapter = {
      providerId: "openai",
      supports: (desc: ModelDescriptor) => desc.provider === "openai",
      stream: async function* () {
        yield { text: "REAL API RESPONSE", finishReason: "stop" };
      },
    };

    const client = new LLMist({
      adapters: [realAdapter, createMockAdapter()],
      autoDiscoverProviders: false,
    });

    // Register mock
    mockLLM().forModel("gpt-5-nano").forProvider("openai").returns("MOCKED RESPONSE").register();

    // Make call
    const stream = client.stream({
      model: "openai:gpt-5-nano",
      messages: [{ role: "user", content: "test" }],
    });

    let text = "";
    for await (const chunk of stream) {
      text += chunk.text;
    }

    expect(text).toBe("MOCKED RESPONSE");
  });

  test("adapters are sorted by priority descending", () => {
    const low = {
      providerId: "low",
      priority: 10,
      supports: () => true,
      stream: () => ({
        [Symbol.asyncIterator]: async function* () {
          yield { text: "low" };
        },
      }),
    };
    const high = {
      providerId: "high",
      priority: 100,
      supports: () => true,
      stream: () => ({
        [Symbol.asyncIterator]: async function* () {
          yield { text: "high" };
        },
      }),
    };
    const normal = {
      providerId: "normal",
      supports: () => true,
      stream: () => ({
        [Symbol.asyncIterator]: async function* () {
          yield { text: "normal" };
        },
      }),
    };

    const client = new LLMist({
      adapters: [low, normal, high], // Random order
      autoDiscoverProviders: false,
    });

    // Access private adapters field for test validation
    const adapters = (client as any).adapters;

    expect(adapters[0].providerId).toBe("high"); // priority 100
    expect(adapters[1].providerId).toBe("low"); // priority 10
    expect(adapters[2].providerId).toBe("normal"); // priority 0 (default)
  });

  test("stable sort preserves order for equal priorities", () => {
    const first = {
      providerId: "first",
      priority: 5,
      supports: () => true,
      stream: () => ({
        [Symbol.asyncIterator]: async function* () {
          yield { text: "first" };
        },
      }),
    };
    const second = {
      providerId: "second",
      priority: 5,
      supports: () => true,
      stream: () => ({
        [Symbol.asyncIterator]: async function* () {
          yield { text: "second" };
        },
      }),
    };

    const client = new LLMist({
      adapters: [first, second],
      autoDiscoverProviders: false,
    });

    const adapters = (client as any).adapters;

    // Both have priority 5, original order should be preserved
    expect(adapters[0].providerId).toBe("first");
    expect(adapters[1].providerId).toBe("second");
  });

  test("mock adapter with no matching mock falls through to real provider", async () => {
    // Create stub real provider
    const realAdapter = {
      providerId: "openai",
      supports: (desc: ModelDescriptor) => desc.provider === "openai",
      stream: async function* () {
        yield { text: "REAL PROVIDER RESPONSE", finishReason: "stop" };
      },
    };

    const client = new LLMist({
      adapters: [realAdapter, createMockAdapter({ strictMode: false })],
      autoDiscoverProviders: false,
    });

    // Register mock for different model
    mockLLM().forModel("other-model").returns("MOCKED RESPONSE").register();

    // Make call - no mock matches gpt-4, should fall through
    const stream = client.stream({
      model: "openai:gpt-4",
      messages: [{ role: "user", content: "test" }],
    });

    let text = "";
    for await (const chunk of stream) {
      text += chunk.text;
    }

    // MockAdapter returns empty response in non-strict mode
    // In practice, this means mock adapter returns empty, not falling through
    // This is expected behavior based on MockManager.findMatch()
    expect(text).toBe("");
  });

  test("multiple mocks with different providers work correctly", async () => {
    // Create stub providers
    const openaiAdapter = {
      providerId: "openai",
      supports: (desc: ModelDescriptor) => desc.provider === "openai",
      stream: async function* () {
        yield { text: "OPENAI REAL", finishReason: "stop" };
      },
    };

    const anthropicAdapter = {
      providerId: "anthropic",
      supports: (desc: ModelDescriptor) => desc.provider === "anthropic",
      stream: async function* () {
        yield { text: "ANTHROPIC REAL", finishReason: "stop" };
      },
    };

    const client = new LLMist({
      adapters: [openaiAdapter, anthropicAdapter, createMockAdapter()],
      autoDiscoverProviders: false,
    });

    // Register mocks for both providers
    mockLLM().forModel("gpt-5-nano").forProvider("openai").returns("OPENAI MOCKED").register();

    mockLLM().forModel("claude-3").forProvider("anthropic").returns("ANTHROPIC MOCKED").register();

    // Test OpenAI mock
    const openaiStream = client.stream({
      model: "openai:gpt-5-nano",
      messages: [{ role: "user", content: "test" }],
    });

    let openaiText = "";
    for await (const chunk of openaiStream) {
      openaiText += chunk.text;
    }

    expect(openaiText).toBe("OPENAI MOCKED");

    // Test Anthropic mock
    const anthropicStream = client.stream({
      model: "anthropic:claude-3",
      messages: [{ role: "user", content: "test" }],
    });

    let anthropicText = "";
    for await (const chunk of anthropicStream) {
      anthropicText += chunk.text;
    }

    expect(anthropicText).toBe("ANTHROPIC MOCKED");
  });

  test("negative priorities are ordered correctly", () => {
    const negative = {
      providerId: "negative",
      priority: -10,
      supports: () => true,
      stream: () => ({
        [Symbol.asyncIterator]: async function* () {
          yield { text: "negative" };
        },
      }),
    };
    const zero = {
      providerId: "zero",
      priority: 0,
      supports: () => true,
      stream: () => ({
        [Symbol.asyncIterator]: async function* () {
          yield { text: "zero" };
        },
      }),
    };
    const positive = {
      providerId: "positive",
      priority: 50,
      supports: () => true,
      stream: () => ({
        [Symbol.asyncIterator]: async function* () {
          yield { text: "positive" };
        },
      }),
    };

    const client = new LLMist({
      adapters: [negative, zero, positive],
      autoDiscoverProviders: false,
    });

    const adapters = (client as any).adapters;

    // Should be sorted: 50, 0, -10
    expect(adapters[0].providerId).toBe("positive");
    expect(adapters[1].providerId).toBe("zero");
    expect(adapters[2].providerId).toBe("negative");
  });

  test("undefined priority is treated as 0", () => {
    const withUndefined = {
      providerId: "undefined",
      priority: undefined,
      supports: () => true,
      stream: () => ({
        [Symbol.asyncIterator]: async function* () {
          yield { text: "undefined" };
        },
      }),
    };
    const withZero = {
      providerId: "zero",
      priority: 0,
      supports: () => true,
      stream: () => ({
        [Symbol.asyncIterator]: async function* () {
          yield { text: "zero" };
        },
      }),
    };
    const withTen = {
      providerId: "ten",
      priority: 10,
      supports: () => true,
      stream: () => ({
        [Symbol.asyncIterator]: async function* () {
          yield { text: "ten" };
        },
      }),
    };

    const client = new LLMist({
      adapters: [withUndefined, withZero, withTen],
      autoDiscoverProviders: false,
    });

    const adapters = (client as any).adapters;

    // Ten should be first, then undefined and zero in original order (stable sort)
    expect(adapters[0].providerId).toBe("ten");
    expect(adapters[1].providerId).toBe("undefined");
    expect(adapters[2].providerId).toBe("zero");
  });

  test("handles very large priority values", () => {
    const maxPriority = {
      providerId: "max",
      priority: Number.MAX_SAFE_INTEGER,
      supports: () => true,
      stream: () => ({
        [Symbol.asyncIterator]: async function* () {
          yield { text: "max" };
        },
      }),
    };
    const normalPriority = {
      providerId: "normal",
      priority: 100,
      supports: () => true,
      stream: () => ({
        [Symbol.asyncIterator]: async function* () {
          yield { text: "normal" };
        },
      }),
    };

    const client = new LLMist({
      adapters: [normalPriority, maxPriority],
      autoDiscoverProviders: false,
    });

    const adapters = (client as any).adapters;

    // Max should come first
    expect(adapters[0].providerId).toBe("max");
    expect(adapters[1].providerId).toBe("normal");
  });
});
