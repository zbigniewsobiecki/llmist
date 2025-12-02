import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LLMist } from "../core/client.js";
import { createMockAdapter } from "./mock-adapter.js";
import { mockLLM } from "./mock-builder.js";
import { createMockClient } from "./mock-client.js";
import { getMockManager, MockManager } from "./mock-manager.js";
import type { MockMatcherContext } from "./mock-types.js";

describe("MockManager", () => {
  let manager: MockManager;

  beforeEach(() => {
    MockManager.reset();
    manager = MockManager.getInstance();
  });

  afterEach(() => {
    MockManager.reset();
  });

  test("should register and retrieve mocks", () => {
    const mockId = manager.register({
      label: "test mock",
      matcher: () => true,
      response: { text: "test response" },
    });

    expect(mockId).toBeDefined();
    expect(manager.getCount()).toBe(1);
    expect(manager.getMockIds()).toContain(mockId);
  });

  test("should unregister mocks", () => {
    const mockId = manager.register({
      matcher: () => true,
      response: { text: "test" },
    });

    expect(manager.getCount()).toBe(1);
    expect(manager.unregister(mockId)).toBe(true);
    expect(manager.getCount()).toBe(0);
  });

  test("should clear all mocks", () => {
    manager.register({ matcher: () => true, response: { text: "mock1" } });
    manager.register({ matcher: () => true, response: { text: "mock2" } });

    expect(manager.getCount()).toBe(2);
    manager.clear();
    expect(manager.getCount()).toBe(0);
  });

  test("should find matching mock", async () => {
    manager.register({
      label: "gpt-4 mock",
      matcher: (ctx) => ctx.modelName.includes("gpt-4"),
      response: { text: "GPT-4 response" },
    });

    const context: MockMatcherContext = {
      model: "openai:gpt-4",
      provider: "openai",
      modelName: "gpt-4",
      options: { model: "openai:gpt-4", messages: [] },
      messages: [],
    };

    const response = await manager.findMatch(context);
    expect(response).toBeDefined();
    expect(response?.text).toBe("GPT-4 response");
  });

  test("should return null when no mock matches (non-strict mode)", async () => {
    manager.register({
      matcher: (ctx) => ctx.modelName === "gpt-4",
      response: { text: "GPT-4 response" },
    });

    const context: MockMatcherContext = {
      model: "anthropic:claude",
      provider: "anthropic",
      modelName: "claude",
      options: { model: "anthropic:claude", messages: [] },
      messages: [],
    };

    const response = await manager.findMatch(context);
    expect(response).toBeDefined();
    expect(response?.text).toBe(""); // Empty response in non-strict mode
  });

  test("should throw error when no mock matches (strict mode)", async () => {
    manager.setOptions({ strictMode: true });

    const context: MockMatcherContext = {
      model: "anthropic:claude",
      provider: "anthropic",
      modelName: "claude",
      options: { model: "anthropic:claude", messages: [] },
      messages: [],
    };

    await expect(manager.findMatch(context)).rejects.toThrow();
  });

  test("should remove one-time mocks after use", async () => {
    const _mockId = manager.register({
      matcher: () => true,
      response: { text: "once" },
      once: true,
    });

    expect(manager.getCount()).toBe(1);

    const context: MockMatcherContext = {
      model: "mock:test",
      provider: "mock",
      modelName: "test",
      options: { model: "mock:test", messages: [] },
      messages: [],
    };

    await manager.findMatch(context);
    expect(manager.getCount()).toBe(0);
  });

  test("should record stats with accurate timestamps", async () => {
    const beforeRegister = Date.now();
    const mockId = manager.register({
      matcher: () => true,
      response: { text: "test" },
    });

    const context: MockMatcherContext = {
      model: "mock:test",
      provider: "mock",
      modelName: "test",
      options: { model: "mock:test", messages: [] },
      messages: [],
    };

    await manager.findMatch(context);
    const afterFirstMatch = Date.now();

    await manager.findMatch(context);
    const afterSecondMatch = Date.now();

    const stats = manager.getStats(mockId);
    expect(stats?.matchCount).toBe(2);
    // Validate lastUsed is a Date object with a recent timestamp
    expect(stats?.lastUsed).toBeInstanceOf(Date);
    const lastUsedTime = stats!.lastUsed!.getTime();
    expect(lastUsedTime).toBeGreaterThanOrEqual(beforeRegister);
    expect(lastUsedTime).toBeLessThanOrEqual(afterSecondMatch);
  });

  test("should handle many registered mocks (stress test)", async () => {
    // Register 50 mocks with different model conditions
    for (let i = 0; i < 50; i++) {
      manager.register({
        label: `mock-${i}`,
        matcher: (ctx) => ctx.modelName === `model-${i}`,
        response: { text: `response-${i}` },
      });
    }

    expect(manager.getCount()).toBe(50);

    // Test that we can find a specific mock in the middle
    const context: MockMatcherContext = {
      model: "mock:model-25",
      provider: "mock",
      modelName: "model-25",
      options: { model: "mock:model-25", messages: [] },
      messages: [],
    };

    const response = await manager.findMatch(context);
    expect(response?.text).toBe("response-25");
  });

  test("should accumulate stats across multiple matches", async () => {
    const mockId = manager.register({
      matcher: () => true,
      response: { text: "test" },
    });

    const context: MockMatcherContext = {
      model: "mock:test",
      provider: "mock",
      modelName: "test",
      options: { model: "mock:test", messages: [] },
      messages: [],
    };

    // Match 5 times
    for (let i = 0; i < 5; i++) {
      await manager.findMatch(context);
    }

    const stats = manager.getStats(mockId);
    expect(stats?.matchCount).toBe(5);
  });

  test("should support async matchers", async () => {
    manager.register({
      matcher: async (ctx) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return ctx.modelName === "gpt-4";
      },
      response: { text: "async response" },
    });

    const context: MockMatcherContext = {
      model: "mock:gpt-4",
      provider: "mock",
      modelName: "gpt-4",
      options: { model: "mock:gpt-4", messages: [] },
      messages: [],
    };

    const response = await manager.findMatch(context);
    expect(response?.text).toBe("async response");
  });

  test("should support function responses", async () => {
    manager.register({
      matcher: () => true,
      response: (ctx) => ({
        text: `Response for ${ctx.modelName}`,
      }),
    });

    const context: MockMatcherContext = {
      model: "mock:custom-model",
      provider: "mock",
      modelName: "custom-model",
      options: { model: "mock:custom-model", messages: [] },
      messages: [],
    };

    const response = await manager.findMatch(context);
    expect(response?.text).toBe("Response for custom-model");
  });
});

describe("MockBuilder", () => {
  beforeEach(() => {
    MockManager.reset();
  });

  afterEach(() => {
    MockManager.reset();
  });

  test("should build mock with forModel", () => {
    const mock = mockLLM().forModel("gpt-4").returns("Hello").build();

    expect(mock.response).toEqual({ text: "Hello" });
  });

  test("should build mock with multiple conditions", () => {
    const mock = mockLLM()
      .forModel("gpt-4")
      .forProvider("openai")
      .whenMessageContains("hello")
      .returns("Hi there!")
      .build();

    expect(mock.response).toEqual({ text: "Hi there!" });
  });

  test("should build mock with gadget calls", () => {
    const mock = mockLLM()
      .forModel("gpt-4")
      .returnsGadgetCall("calculator", { op: "add", a: 1, b: 2 })
      .build();

    expect(mock.response.gadgetCalls).toHaveLength(1);
    expect(mock.response.gadgetCalls?.[0].gadgetName).toBe("calculator");
  });

  test("should register mock and return ID", () => {
    const mockId = mockLLM().forModel("gpt-4").returns("Test").register();

    const manager = getMockManager();
    expect(manager.getMockIds()).toContain(mockId);
  });

  test("should match based on message content", async () => {
    const mock = mockLLM().whenMessageContains("calculate").returns("Computing...").build();

    const context: MockMatcherContext = {
      model: "mock:gpt-4",
      provider: "mock",
      modelName: "gpt-4",
      options: {
        model: "mock:gpt-4",
        messages: [{ role: "user", content: "Please calculate this" }],
      },
      messages: [{ role: "user", content: "Please calculate this" }],
    };

    const matches = await mock.matcher(context);
    expect(matches).toBe(true);
  });

  test("should support once() modifier", () => {
    const mock = mockLLM().forModel("gpt-4").returns("One time").once().build();

    expect(mock.once).toBe(true);
  });

  test("should support custom labels", () => {
    const mock = mockLLM().forModel("gpt-4").returns("Test").withLabel("Test Mock").build();

    expect(mock.label).toBe("Test Mock");
  });

  test("should support usage and finish reason", () => {
    const mock = mockLLM()
      .forModel("gpt-4")
      .returns("Test")
      .withUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
      .withFinishReason("stop")
      .build();

    expect(mock.response.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(mock.response.finishReason).toBe("stop");
  });
});

describe("MockProviderAdapter", () => {
  beforeEach(() => {
    MockManager.reset();
  });

  afterEach(() => {
    MockManager.reset();
  });

  test("should support all providers", () => {
    const adapter = createMockAdapter();
    expect(adapter.supports({ provider: "mock", name: "gpt-4" })).toBe(true);
    expect(adapter.supports({ provider: "openai", name: "gpt-4" })).toBe(true);
    expect(adapter.supports({ provider: "anthropic", name: "claude-3" })).toBe(true);
  });

  test("should stream mock response", async () => {
    mockLLM().forModel("gpt-4").returns("Hello, world!").register();

    const adapter = createMockAdapter();
    const stream = adapter.stream(
      { model: "mock:gpt-4", messages: [] },
      { provider: "mock", name: "gpt-4" },
    );

    let fullText = "";
    for await (const chunk of stream) {
      fullText += chunk.text;
    }

    expect(fullText).toBe("Hello, world!");
  });

  test("should work with LLMist client", async () => {
    mockLLM().forModel("test").returns("Mocked!").register();

    const client = new LLMist({
      adapters: [createMockAdapter()],
      autoDiscoverProviders: false,
      defaultProvider: "mock",
    });

    const stream = client.stream({
      model: "mock:test",
      messages: [{ role: "user", content: "Hello" }],
    });

    let fullText = "";
    for await (const chunk of stream) {
      fullText += chunk.text;
    }

    expect(fullText).toBe("Mocked!");
  });
});

describe("createMockClient", () => {
  beforeEach(() => {
    MockManager.reset();
  });

  afterEach(() => {
    MockManager.reset();
  });

  test("should create preconfigured client", async () => {
    mockLLM().forModel("test").returns("From mock client").register();

    const client = createMockClient();
    const stream = client.stream({
      model: "mock:test",
      messages: [{ role: "user", content: "Test" }],
    });

    let fullText = "";
    for await (const chunk of stream) {
      fullText += chunk.text;
    }

    expect(fullText).toBe("From mock client");
  });
});

describe("Integration tests", () => {
  beforeEach(() => {
    MockManager.reset();
  });

  afterEach(() => {
    MockManager.reset();
  });

  test("should match based on complex conditions", async () => {
    mockLLM()
      .forProvider("mock")
      .whenMessageCount((count) => count > 2)
      .whenLastMessageContains("summarize")
      .returns("Here is a summary...")
      .register();

    const client = createMockClient();
    const stream = client.stream({
      model: "mock:gpt-4",
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "Tell me about AI" },
        { role: "assistant", content: "AI is..." },
        { role: "user", content: "Can you summarize?" },
      ],
    });

    let fullText = "";
    for await (const chunk of stream) {
      fullText += chunk.text;
    }

    expect(fullText).toBe("Here is a summary...");
  });

  test("should handle gadget calls in mock response", async () => {
    mockLLM()
      .forModel("test")
      .returns("Calculating...")
      .returnsGadgetCall("calculator", { operation: "add", a: 5, b: 3 })
      .register();

    const client = createMockClient();
    const stream = client.stream({
      model: "mock:test",
      messages: [{ role: "user", content: "Add 5 and 3" }],
    });

    let fullText = "";
    for await (const chunk of stream) {
      fullText += chunk.text;
    }

    // Should include both text and gadget marker in block format
    expect(fullText).toContain("Calculating...");
    expect(fullText).toContain("!!!GADGET_START:calculator");
    expect(fullText).toContain("!!!ARG:operation");
    expect(fullText).toContain("add");
  });

  test("should respect once() modifier", async () => {
    mockLLM().forModel("test").returns("First call").once().register();

    mockLLM().forModel("test").returns("Subsequent calls").register();

    const client = createMockClient();

    // First call
    let stream = client.stream({ model: "mock:test", messages: [] });
    let text = "";
    for await (const chunk of stream) {
      text += chunk.text;
    }
    expect(text).toBe("First call");

    // Second call
    stream = client.stream({ model: "mock:test", messages: [] });
    text = "";
    for await (const chunk of stream) {
      text += chunk.text;
    }
    expect(text).toBe("Subsequent calls");
  });
});
